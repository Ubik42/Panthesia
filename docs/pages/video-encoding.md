# Video encoding

### For Linux and Windows

You can download `panthesia-cli` from [releasses](https://github.com/PolyMeilex/Neothesia/releases)

### For macOS

To encode video you need to install `rust` and `ffmpeg`.

Then compile the panthesia-cli: `make build-recorder`

It will compile panthesia-cli, from now on it is used as a command line tool

To encode a test.mid file run `./target/release/panthesia-cli ./test.mid`

Video will be outputted to `./out` directory
