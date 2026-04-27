const path = require("node:path");

const { buildDatabase } = require("../electron/store");

const dbPath = path.join(__dirname, "..", "engram.db");
const dataDir = path.join(__dirname, "..", "data");

const total = buildDatabase({ dbPath, dataDir });

console.log(`数据库已生成: ${dbPath}`);
console.log(`导入单词数: ${total}`);
