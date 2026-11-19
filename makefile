build-app:
	cargo build --release --bin panthesia
run-app:
	cargo run --release --bin panthesia

install-app:
	cargo install --path panthesia

check-recorder:
	cargo check -p panthesia-cli
build-recorder:
	cargo build --release -p panthesia-cli
run-recorder:
	cargo run --release -p panthesia-cli -- $(file)

