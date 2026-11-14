import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const domain = "xuxian.android.signing.identity.v1";
function wrappingKey(master, salt) {
  return hkdfSync(
    "sha256",
    Buffer.from(master.replaceAll("\r", "").trim()),
    salt,
    Buffer.from(domain),
    32,
  );
}
export function wrapIdentity(identity, master) {
  const salt = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", wrappingKey(master, salt), iv);
  cipher.setAAD(Buffer.from(domain));
  const data = Buffer.concat([
    cipher.update(JSON.stringify(identity), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: "AES-256-GCM/HKDF-SHA256",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: data.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export function unwrapIdentity(envelope, master) {
  try {
    if (
      envelope.version !== 1 ||
      envelope.algorithm !== "AES-256-GCM/HKDF-SHA256"
    )
      throw Error();
    const decipher = createDecipheriv(
      "aes-256-gcm",
      wrappingKey(master, Buffer.from(envelope.salt, "base64")),
      Buffer.from(envelope.iv, "base64"),
    );
    decipher.setAAD(Buffer.from(domain));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
    const plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, "base64")),
      decipher.final(),
    ]);
    const identity = JSON.parse(plain.toString("utf8"));
    if (
      !identity.keystore ||
      !/^[a-z0-9_-]+$/i.test(identity.alias) ||
      !/^[a-zA-Z0-9_-]{20,120}$/.test(identity.password)
    )
      throw Error();
    return identity;
  } catch {
    throw Error(
      "无法解密 Android 发布身份。请恢复原发布签名密钥，或使用签名备份重新封装；不会生成替代身份。",
    );
  }
}
async function main() {
  let master = process.env.TAURI_SIGNING_PRIVATE_KEY;
  if (!master)
    throw Error(
      "需要现有的 TAURI_SIGNING_PRIVATE_KEY 才能解锁 Android 签名身份",
    );
  if (existsSync(master)) master = await readFile(master, "utf8");
  if (master.trim().length < 50) throw Error("发布签名材料无效");
  if (process.argv[2] === "wrap") {
    const identity = JSON.parse(await readFile(process.argv[3], "utf8"));
    const target = process.argv[4] || "release/android-signing.enc.json";
    if (existsSync(target))
      throw Error(
        "Android 身份备份已存在，不允许覆盖。轮换包装密钥需另行审查。",
      );
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(
      target,
      JSON.stringify(wrapIdentity(identity, master), null, 2) + "\n",
      { mode: 0o600 },
    );
    process.stdout.write(
      "Created authenticated, encrypted Android signing backup.\n",
    );
  } else if (process.argv[2] === "prepare") {
    const identity = unwrapIdentity(
      JSON.parse(await readFile("release/android-signing.enc.json", "utf8")),
      master,
    );
    const folder = resolve("work/android-signing");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const keystore = resolve(folder, "release.p12");
    await writeFile(keystore, Buffer.from(identity.keystore, "base64"), {
      mode: 0o600,
    });
    // Gradle reads credentials from an ignored file; no secret is passed as a command argument or logged.
    const properties = `storeFile=${keystore.replaceAll("\\", "/")}\nstorePassword=${identity.password}\nkeyAlias=${identity.alias}\nkeyPassword=${identity.password}\n`;
    await writeFile("src-tauri/gen/android/keystore.properties", properties, {
      mode: 0o600,
    });
    process.stdout.write("Prepared the existing Android signing identity.\n");
  } else
    throw Error(
      "Usage: android-signing.mjs wrap <private-identity.json> [encrypted-backup] | prepare",
    );
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
)
  main().catch((error) => {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  });
