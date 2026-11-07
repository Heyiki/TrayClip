use std::io::{Read, Write};

fn main() {
    let mut input = Vec::new();
    std::io::stdin().read_to_end(&mut input).unwrap();
    match std::env::args().nth(1).unwrap().as_str() {
        "ok" => print!(r#"{{"protocol":1,"text":"hello"}}"#),
        "exit" => std::process::exit(2),
        "json" => print!("not json"),
        "protocol" => print!(r#"{{"protocol":2,"text":"hello"}}"#),
        "stdout" => std::io::stdout().write_all(&vec![b'x'; 128 * 1024]).unwrap(),
        "stderr" => std::io::stderr().write_all(&vec![b'x'; 128 * 1024]).unwrap(),
        "sleep" => std::thread::sleep(std::time::Duration::from_secs(30)),
        _ => panic!("Unknown fixture"),
    }
}
