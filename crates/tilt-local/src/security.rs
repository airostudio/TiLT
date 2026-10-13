//! Request gate for the local web server. The server only listens on 127.0.0.1, and on top of
//! that every API call must prove it comes from *our* page, defeating:
//! * other websites firing requests at localhost (CSRF)  -> Origin check + SameSite=Strict cookie
//! * DNS-rebinding (evil.com resolving to 127.0.0.1)       -> Host must be 127.0.0.1/localhost:<port>
//! * other local users/processes guessing the API          -> random per-run token (cookie or header)

#[derive(Debug, PartialEq, Eq)]
pub enum Decision {
    Allow,
    /// Wrong Host / Origin.
    Forbidden(&'static str),
    /// Missing or wrong token.
    Unauthorized,
}

pub fn host_ok(host: Option<&str>, port: u16) -> bool {
    match host {
        Some(h) => h == format!("127.0.0.1:{port}") || h == format!("localhost:{port}"),
        None => false,
    }
}

fn origin_ok(origin: Option<&str>, port: u16) -> bool {
    match origin {
        None => true, // same-origin GET/fetch from non-browser clients carry no Origin
        Some(o) => o == format!("http://127.0.0.1:{port}") || o == format!("http://localhost:{port}"),
    }
}

/// Constant-time comparison so the token cannot be learned byte by byte.
pub fn token_eq(a: &str, b: &str) -> bool {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

pub fn cookie_token(cookie_header: Option<&str>) -> Option<&str> {
    cookie_header?.split(';').filter_map(|p| p.trim().strip_prefix("tilt_token=")).next()
}

pub fn gate_api(
    host: Option<&str>,
    origin: Option<&str>,
    cookie: Option<&str>,
    header_token: Option<&str>,
    token: &str,
    port: u16,
) -> Decision {
    if !host_ok(host, port) {
        return Decision::Forbidden("unexpected Host header");
    }
    if !origin_ok(origin, port) {
        return Decision::Forbidden("cross-origin request refused");
    }
    let presented = header_token.or_else(|| cookie_token(cookie));
    match presented {
        Some(t) if token_eq(t, token) => Decision::Allow,
        _ => Decision::Unauthorized,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const T: &str = "abc123";

    #[test]
    fn happy_paths() {
        assert_eq!(gate_api(Some("127.0.0.1:5174"), None, Some("tilt_token=abc123"), None, T, 5174), Decision::Allow);
        assert_eq!(
            gate_api(Some("localhost:5174"), Some("http://localhost:5174"), None, Some("abc123"), T, 5174),
            Decision::Allow
        );
        assert_eq!(
            gate_api(
                Some("127.0.0.1:5174"),
                Some("http://127.0.0.1:5174"),
                Some("other=1; tilt_token=abc123; x=y"),
                None,
                T,
                5174
            ),
            Decision::Allow
        );
    }

    #[test]
    fn dns_rebinding_and_cross_origin_are_refused_even_with_the_token() {
        assert!(matches!(
            gate_api(Some("evil.com:5174"), None, Some("tilt_token=abc123"), None, T, 5174),
            Decision::Forbidden(_)
        ));
        assert!(matches!(
            gate_api(Some("127.0.0.1:5174"), Some("https://evil.com"), Some("tilt_token=abc123"), None, T, 5174),
            Decision::Forbidden(_)
        ));
        assert!(matches!(gate_api(None, None, Some("tilt_token=abc123"), None, T, 5174), Decision::Forbidden(_)));
        assert!(matches!(
            gate_api(Some("127.0.0.1:9999"), None, Some("tilt_token=abc123"), None, T, 5174),
            Decision::Forbidden(_)
        ));
    }

    #[test]
    fn missing_or_wrong_token_is_unauthorized() {
        assert_eq!(gate_api(Some("127.0.0.1:5174"), None, None, None, T, 5174), Decision::Unauthorized);
        assert_eq!(
            gate_api(Some("127.0.0.1:5174"), None, Some("tilt_token=nope"), None, T, 5174),
            Decision::Unauthorized
        );
        assert_eq!(
            gate_api(Some("127.0.0.1:5174"), None, Some("tilt_token=abc1234"), None, T, 5174),
            Decision::Unauthorized
        );
        assert_eq!(gate_api(Some("127.0.0.1:5174"), None, None, Some(""), T, 5174), Decision::Unauthorized);
    }

    #[test]
    fn constant_time_eq_and_cookie_parsing() {
        assert!(token_eq("a", "a") && !token_eq("a", "b") && !token_eq("a", "ab"));
        assert_eq!(cookie_token(Some("a=1; tilt_token=xyz")), Some("xyz"));
        assert_eq!(cookie_token(Some("a=1")), None);
        assert_eq!(cookie_token(None), None);
    }
}
