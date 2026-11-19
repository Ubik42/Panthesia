use super::OutputDescriptor;
pub use panthesia_vst3::Vst3OutputConnection;
use std::{error::Error, path::Path};
pub struct Vst3Backend(panthesia_vst3::Vst3Backend);
impl Vst3Backend {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        Ok(Self(panthesia_vst3::Vst3Backend::new()?))
    }
    pub fn get_outputs(&self) -> Vec<OutputDescriptor> {
        self.0
            .get_outputs()
            .into_iter()
            .map(OutputDescriptor::Vst3)
            .collect()
    }
    pub fn new_output_connection(
        &self,
        path: &Path,
    ) -> Result<Vst3OutputConnection, Box<dyn Error>> {
        self.0.new_output_connection(path)
    }
}
