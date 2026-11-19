fn main() {
    let version = std::env::var("CARGO_PKG_VERSION").unwrap();
    println!("cargo:rerun-if-env-changed=PANTHESIA_BUILD_INFO");
    let identity = match std::env::var("PANTHESIA_BUILD_INFO").or_else(|_|std::env::var("NEOTHESIA_BUILD_INFO")) {
        Ok(raw) => {
            let value: serde_json::Value =
                serde_json::from_str(&raw).expect("构建来源信息不是有效 JSON");
            assert_eq!(value["schemaVersion"], 1, "构建来源信息版本无效");
            assert_eq!(
                value["target"].as_str(),
                Some("Desktop"),
                "桌面程序收到了其他构建目标的来源信息"
            );
            let profile = std::env::var("PROFILE").unwrap();
            assert!(
                value["configuration"]
                    .as_str()
                    .is_some_and(|mode| mode.eq_ignore_ascii_case(&profile)),
                "桌面构建模式与来源记录不一致"
            );
            assert_eq!(
                value["version"].as_str(),
                Some(version.as_str()),
                "桌面版本与构建记录不一致"
            );
            assert!(
                value["version"].is_string()
                    && value["buildId"].is_string()
                    && value["sourceFingerprint"].is_string(),
                "构建来源信息缺少版本或来源标识"
            );
            for (key, length) in [("buildId", 32), ("sourceFingerprint", 64)] {
                assert!(
                    value[key].as_str().is_some_and(|text| text.len() == length
                        && text.bytes().all(|byte| byte.is_ascii_hexdigit())),
                    "构建来源标识格式无效：{key}"
                );
            }
            value
        }
        Err(_) => serde_json::json!({
            "schemaVersion": 1, "version": version,
            "target": "Desktop", "configuration": std::env::var("PROFILE").unwrap(),
            "buildId": null, "builtAt": null, "revision": null, "dirty": null,
            "sourceFingerprint": null, "sourceFiles": null,
        }),
    };
    println!("cargo:rustc-env=PANTHESIA_BUILD_INFO={identity}");
    tauri_build::build()
}
