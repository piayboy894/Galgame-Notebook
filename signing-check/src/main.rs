use base64::Engine;
use minisign_verify::{PublicKey,Signature};
fn decode(s:&str)->String{String::from_utf8(base64::engine::general_purpose::STANDARD.decode(s.trim()).unwrap()).unwrap()}
fn main(){
 let args:Vec<_>=std::env::args().collect();
 let config:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(&args[1]).unwrap()).unwrap();
 let key=PublicKey::decode(&decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())).unwrap();
 let signature=Signature::decode(&decode(&std::fs::read_to_string(format!("{}.sig",args[2])).unwrap())).unwrap();
 let mut bytes=std::fs::read(&args[2]).unwrap();
 key.verify(&bytes,&signature,true).expect("The published artifact must verify");
 println!("PASS: Actions signing secret matches the application public key");
 println!("Trusted signature metadata: {}",signature.trusted_comment());
 bytes[1024]^=1;
 assert!(key.verify(&bytes,&signature,true).is_err());
 println!("PASS: modified test bytes are rejected");
}
