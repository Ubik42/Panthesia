//! Inspect actual source documents without loading a renderer or audio device.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut reports = Vec::new();
    for path in std::env::args().skip(1) {
        let bytes = std::fs::read(&path)?;
        let report = panthesia_notation::score_document::inspect(&bytes)?;
        reports.push(serde_json::json!({"path":path,"capabilities":report}));
    }
    println!("{}", serde_json::to_string_pretty(&reports)?);
    Ok(())
}
