//! Bounded display decoding. Original MusicXML/MXL bytes remain source assets.
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request { pub bytes:Vec<u8> }
pub fn decode(bytes:Vec<u8>)->Result<Vec<u8>,String> {
    panthesia_notation::musicxml::musicxml_source(&bytes).map_err(|error|error.to_string())
}
