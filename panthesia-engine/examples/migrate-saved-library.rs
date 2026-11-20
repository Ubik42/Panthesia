//! cargo run -p panthesia-engine --example migrate-saved-library -- <profile> <report.json> [--apply]
fn main() {
    let args = std::env::args_os().skip(1).collect::<Vec<_>>();
    if args.len() < 2 || args.len() > 3 || args.get(2).is_some_and(|v| v != "--apply") {
        eprintln!("Usage: migrate-saved-library <profile> <report.json> [--apply]");
        std::process::exit(2);
    }
    match panthesia_engine::library_migration::run(
        std::path::Path::new(&args[0]),
        std::path::Path::new(&args[1]),
        args.len() == 3,
    ) {
        Ok(value) => {
            println!(
                "{}",
                serde_json::json!({"status":value["status"],"candidates":value["items"].as_array().map(Vec::len),"migrated":value["migrated"],"unmatched":value["unmatched"],"failed":value["failed"],"report":args[1].to_string_lossy()})
            );
            if value["failed"].as_u64().is_some_and(|n| n > 0) {
                std::process::exit(1);
            }
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
