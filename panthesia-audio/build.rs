fn main() {
    println!("cargo:rerun-if-changed=src/stretch.cpp");
    let mut build = cc::Build::new();
    build.cpp(true).file("src/stretch.cpp").include("vendor/signalsmith-stretch").warnings(false);
    if build.get_compiler().is_like_msvc() {
        build.flag("/utf-8").flag("/std:c++17").flag("/O2");
    } else {
        build.flag("-std=c++17").flag("-O2");
    }
    build.compile("panthesia_stretch");
}
