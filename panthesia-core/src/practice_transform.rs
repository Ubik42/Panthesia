//! Practice transformations are domain values shared by management, playback and generation.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Variant {
    pub transpose: i8,
    /// 0 = original timing; otherwise a whole-note subdivision.
    pub quantize: u8,
    pub durations: bool,
    pub tonic: Option<u8>,
    pub minor: Option<bool>,
}

impl Default for Variant {
    fn default() -> Self {
        Self {
            transpose: 0,
            quantize: 0,
            durations: true,
            tonic: None,
            minor: None,
        }
    }
}
impl Variant {
    pub fn from_grid(grid: &str) -> Result<Self, String> {
        let Some((_, signature)) = grid.split_once(";practice-v1:") else {
            return Ok(Self::default());
        };
        let values: Vec<_> = signature.split(',').collect();
        if values.len() != 3 {
            return Err("历史练习版本信息不完整".into());
        }
        let value = Self {
            transpose: values[0].parse().map_err(|_| "历史转调信息无效")?,
            quantize: values[1].parse().map_err(|_| "历史量化信息无效")?,
            durations: match values[2] {
                "1" => true,
                "0" => false,
                _ => return Err("历史量化时值无效".into()),
            },
            ..Default::default()
        };
        value.validate()?;
        Ok(value)
    }
    pub fn active(&self) -> bool {
        self.transpose != 0 || self.quantize != 0
    }
    pub fn validate(&self) -> Result<(), String> {
        if !(-24..=24).contains(&self.transpose)
            || ![0, 8, 16, 32].contains(&self.quantize)
            || self.tonic.is_some_and(|v| v > 11)
        {
            return Err("转调或量化设置无效".into());
        }
        Ok(())
    }
    pub fn signature(&self) -> String {
        format!(
            ";practice-v1:{},{},{}",
            self.transpose,
            self.quantize,
            u8::from(self.durations)
        )
    }
}
