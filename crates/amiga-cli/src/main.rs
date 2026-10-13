//! `amiga-studio-cli`: diagnostics and scripting front end for amiga-core.
use amiga_core::{adf, dms, engine, hdf, matrix, rom};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

fn usage() -> ExitCode {
    eprintln!(
        "amiga-studio-cli <command>\n\n\
         rom <file>               inspect a Kickstart ROM\n\
         adf <file>               inspect an ADF disk image\n\
         dms <file> [out.adf]     test/convert a DMS archive (never overwrites)\n\
         hdf <file>               inspect a hard disk image (read-only)\n\
         profile-config <preset> [rom] [ext-rom]
                                  print the generated Amiberry config for a preset
         engine [path]            locate/probe the Amiberry engine\n\
         engine-matrix [path]     verify generated configs against the real engine (markdown)\n"
    );
    ExitCode::from(2)
}

fn json<T: serde::Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).unwrap());
}

fn read_limited(p: &Path, max: u64) -> Result<Vec<u8>, String> {
    let md = std::fs::metadata(p).map_err(|e| e.to_string())?;
    if md.len() > max {
        return Err(format!("{} bytes exceeds the {max} byte limit", md.len()));
    }
    std::fs::read(p).map_err(|e| e.to_string())
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let r: Result<(), String> = (|| match args.first().map(String::as_str) {
        Some("rom") => {
            let d = read_limited(Path::new(args.get(1).ok_or("missing file")?), rom::MAX_ROM_SIZE + 16)?;
            json(&rom::inspect(&d).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("adf") => {
            let d = read_limited(Path::new(args.get(1).ok_or("missing file")?), adf::HD_SIZE as u64 + 16)?;
            json(&adf::inspect(&d).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("dms") => {
            let p = Path::new(args.get(1).ok_or("missing file")?);
            let d = read_limited(p, dms::MAX_DMS_INPUT as u64)?;
            json(&dms::info(&d).map_err(|e| e.to_string())?);
            dms::test(&d).map_err(|e| e.to_string())?;
            eprintln!("integrity: OK");
            if let Some(out) = args.get(2) {
                let adf = dms::to_adf(&d).map_err(|e| e.to_string())?;
                let out = PathBuf::from(out);
                if out.exists() {
                    return Err(format!("{} already exists; refusing to overwrite", out.display()));
                }
                let stage = out.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new(".")).to_path_buf();
                amiga_core::fsutil::write_atomic(&out, &stage, &adf, false).map_err(|e| e.to_string())?;
                eprintln!("wrote {} ({} bytes)", out.display(), adf.len());
            }
            Ok(())
        }
        Some("hdf") => {
            json(&hdf::inspect_file(Path::new(args.get(1).ok_or("missing file")?)).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("profile-config") => {
            let id = args.get(1).ok_or("missing preset id")?;
            let p = amiga_core::profiles::from_preset(id, "cli".into(), id.clone()).ok_or("unknown preset")?;
            let media = amiga_core::emu_config::ResolvedMedia {
                rom: args.get(2).map(PathBuf::from),
                ext_rom: args.get(3).map(PathBuf::from),
                ..Default::default()
            };
            print!("{}", amiga_core::emu_config::build_config(&p, &media).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("engine") => {
            let cfg = args.get(1).map(PathBuf::from);
            json(&engine::locate(cfg.as_deref(), None).map_err(|e| e.to_string())?);
            Ok(())
        }
        Some("engine-matrix") => {
            let cfg = args.get(1).map(PathBuf::from);
            let e = engine::locate(cfg.as_deref(), None).map_err(|e| e.to_string())?;
            let scratch = std::env::temp_dir().join(format!("amiga-studio-matrix-{}", std::process::id()));
            let rows = matrix::run(&e, &scratch).map_err(|e| e.to_string())?;
            let _ = std::fs::remove_dir_all(&scratch);
            print!("{}", matrix::render_markdown(&e, &rows));
            Ok(())
        }
        _ => Err("__usage".into()),
    })();
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(m) if m == "__usage" => usage(),
        Err(m) => {
            eprintln!("error: {m}");
            ExitCode::FAILURE
        }
    }
}
