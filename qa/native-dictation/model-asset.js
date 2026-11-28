"use strict";

const shaByLanguage = {
  en: "c920b6dfd8794d024c5b4646a5f3d909f7e9e6876ea73008a96893118a1f5b8c",
  ru: "a88f13bc6efec909dc7a59f81c4afea65a1cdce3f6951aef00c999d999fbba6b",
};

async function verifiedModel(language) {
  const expected = shaByLanguage[language];
  if (!expected) throw new Error("Unknown language model");
  const response = await fetch("/models/" + language + ".tar.gz");
  if (!response.ok) throw new Error("Cannot load local speech model");
  const bytes = await response.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    byte => byte.toString(16).padStart(2, "0")).join("");
  if (digest !== expected) throw new Error("Local model hash mismatch");

  const local = URL.createObjectURL(new Blob([bytes]));
  try {
    return await Vosk.createModel(local + "#" + digest);
  } finally {
    URL.revokeObjectURL(local);
  }
}
