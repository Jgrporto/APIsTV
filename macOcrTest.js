import fs from "fs";
import path from "path";
import Tesseract from "tesseract.js";

function extrairMacDeTexto(texto) {
  if (!texto) return null;

  const cleaned = (texto || "")
    .replace(/\bMAC\b\s*[:=\-]?\s*/gi, " ")
    .replace(/[O]/g, "0")
    .replace(/[Il]/g, "1");

  const macRegex = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{2}[\s:\-._]){5}[0-9A-Fa-f]{2}/g;
  const contiguousRegex = /[0-9A-Fa-f]{12,14}/g;

  const candidates = [];

  const pushCandidate = (raw) => {
    if (!raw) return;
    let mac = raw.replace(/[^0-9A-F]/gi, "").toUpperCase();
    if (mac.length < 12) return;
    if (mac.length > 12) mac = mac.slice(0, 12); // tolera lixo apos o MAC (ex.: "....AD 1g")
    candidates.push(mac.match(/.{2}/g).join(":"));
  };

  const matches = cleaned.match(macRegex);
  if (matches?.length) matches.forEach(pushCandidate);

  const contiguous = cleaned.match(contiguousRegex);
  if (contiguous?.length) contiguous.forEach(pushCandidate);

  if (!candidates.length) return null;

  const textoUpper = cleaned.toUpperCase();
  const macIndex = textoUpper.indexOf("MAC");

  const score = (mac) => {
    const pos = textoUpper.indexOf(mac);
    const hasExactLen = mac.length === 17;
    let s = 0;
    if (hasExactLen) s += 3;
    if (pos >= 0 && macIndex >= 0) s += Math.max(0, 5 - Math.abs(pos - macIndex) / 5);
    if (pos >= 0) s += 1;
    return s;
  };

  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] || null;
}

async function ocrTexto(buffer, options = {}) {
  const res = await Tesseract.recognize(buffer, "eng", options).catch((err) => {
    console.error("OCR failed:", err.message);
    return null;
  });
  return res?.data?.text || "";
}

async function extrairMacDaImagem(filePath) {
  const buffer = await fs.promises.readFile(filePath);

  console.log(`\nLendo imagem: ${filePath}`);
  console.log(`Tamanho: ${buffer.length} bytes`);

  const textoPrimario = await ocrTexto(buffer);
  const macPrimario = extrairMacDeTexto(textoPrimario);

  console.log("\n--- OCR primario ---");
  console.log(textoPrimario.trim() || "<sem texto>");
  console.log("MAC detectado (primario):", macPrimario || "<nenhum>");

  if (macPrimario) {
    return { mac: macPrimario, textoPrimario, textoFallback: "" };
  }

  console.log("\nNenhum MAC no OCR primario, tentando fallback restrito...");

  const textoFallback = await ocrTexto(buffer, {
    tessedit_char_whitelist: "0123456789ABCDEFabcdef:",
    preserve_interword_spaces: "1",
    tessedit_pageseg_mode: "6"
  });
  const macFallback = extrairMacDeTexto(textoFallback);

  console.log("\n--- OCR fallback ---");
  console.log(textoFallback.trim() || "<sem texto>");
  console.log("MAC detectado (fallback):", macFallback || "<nenhum>");

  if (!macFallback) {
    const base = (textoFallback || textoPrimario || "").trim();
    const hasText = !!base;
    const motivo = hasText ? "Nenhum padrao de MAC encontrado no texto extraido" : "OCR vazio (sem texto legivel)";
    console.log("Motivo da falha:", motivo);
  }

  return { mac: macFallback, textoPrimario, textoFallback };
}

async function main() {
  const fileArg = process.argv[2];
  if (!fileArg) {
    console.error("Uso: node macOcrTest.js caminho/para/imagem.jpg");
    process.exit(1);
  }

  const filePath = path.resolve(fileArg);
  const exists = fs.existsSync(filePath);
  if (!exists) {
    console.error("Arquivo nao encontrado:", filePath);
    process.exit(1);
  }

  const result = await extrairMacDaImagem(filePath);
  console.log("\nResultado final:", result.mac ? `MAC=${result.mac}` : "Nenhum MAC detectado");
}

main().catch((err) => {
  console.error("Falha no teste de OCR:", err.message);
  process.exit(1);
});
