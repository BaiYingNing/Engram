const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const INTERVALS_MS = [
  10 * 60 * 1000,
  1 * 24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000
];

const APP_META_CURRENT_BOOK_KEY = "current_book_key";
const APP_META_SCHEMA_VERSION = "schema_version";
const SCHEMA_VERSION = 2;

const BUILTIN_BOOK_TITLES = {
  CET4: "\u5927\u5b66\u82f1\u8bed\u56db\u7ea7",
  CET6: "\u5927\u5b66\u82f1\u8bed\u516d\u7ea7",
  KAOYAN: "\u8003\u7814\u8bcd\u6c47",
  IELTS: "\u96c5\u601d\u8bcd\u6c47",
  TOEFL: "\u6258\u798f\u8bcd\u6c47"
};

function shuffle(items) {
  const cloned = [...items];
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cloned[index], cloned[swapIndex]] = [cloned[swapIndex], cloned[index]];
  }
  return cloned;
}

function splitDefinitions(text) {
  return String(text || "")
    .split(/[;；、/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizePos(pos) {
  return String(pos || "").trim() || "未分类";
}

function addMeaning(map, pos, text) {
  const definitions = splitDefinitions(text);
  if (!definitions.length) {
    return;
  }

  const normalizedPos = normalizePos(pos);
  const bucket = map.get(normalizedPos) || new Set();
  definitions.forEach((definition) => bucket.add(definition));
  map.set(normalizedPos, bucket);
}

function mergeMeanings(target, source) {
  const merged = new Map();

  [...target, ...source].forEach((entry) => {
    const bucket = merged.get(entry.pos) || new Set();
    (entry.definitions || []).forEach((definition) => bucket.add(definition));
    merged.set(entry.pos, bucket);
  });

  return Array.from(merged.entries()).map(([pos, definitions]) => ({
    pos,
    definitions: [...definitions]
  }));
}

function buildTranslationSummary(meanings) {
  return meanings
    .map((entry) => `${entry.pos} ${entry.definitions.join("；")}`.trim())
    .join(" / ");
}

function extractRecord(item, bookKey) {
  const wordRoot = item?.content?.word || {};
  const content = wordRoot.content || {};
  const transEntries = content.trans || [];
  const synoEntries = content.syno?.synos || [];
  const meaningMap = new Map();

  transEntries.forEach((entry) => {
    addMeaning(meaningMap, entry.pos, entry.tranCn);
  });

  synoEntries.forEach((entry) => {
    addMeaning(meaningMap, entry.pos, entry.tran);
  });

  const meanings = Array.from(meaningMap.entries()).map(([pos, definitions]) => ({
    pos,
    definitions: [...definitions]
  }));

  return {
    book_key: bookKey,
    word: String(item?.headWord || "").trim(),
    word_id: String(wordRoot.wordId || "").trim(),
    source_book_id: String(item?.bookId || "").trim(),
    phonetic_uk: content.ukphone || "",
    phonetic_us: content.usphone || "",
    meanings,
    translation_summary: buildTranslationSummary(meanings)
  };
}

function recordScore(record) {
  return [
    record.phonetic_uk,
    record.phonetic_us,
    record.translation_summary,
    ...(record.meanings || []).flatMap((entry) => entry.definitions || [])
  ].filter(Boolean).length;
}

function mergeRecords(baseRecord, nextRecord) {
  const preferred = recordScore(nextRecord) > recordScore(baseRecord) ? nextRecord : baseRecord;
  const fallback = preferred === baseRecord ? nextRecord : baseRecord;
  const meanings = mergeMeanings(baseRecord.meanings || [], nextRecord.meanings || []);

  return {
    book_key: preferred.book_key,
    word: preferred.word,
    word_id: preferred.word_id || fallback.word_id,
    source_book_id: preferred.source_book_id || fallback.source_book_id,
    phonetic_uk: preferred.phonetic_uk || fallback.phonetic_uk,
    phonetic_us: preferred.phonetic_us || fallback.phonetic_us,
    meanings,
    translation_summary: buildTranslationSummary(meanings)
  };
}

function normalizeBookTitle(bookKey) {
  return BUILTIN_BOOK_TITLES[bookKey] || bookKey;
}

function discoverBooks(dataDir) {
  const entries = fs.readdirSync(dataDir, { withFileTypes: true });
  const groups = new Map();

  entries.forEach((entry) => {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      const match = /^([A-Za-z0-9]+)_\d+\.json$/i.exec(entry.name);
      if (!match) {
        return;
      }
      const bookKey = match[1].toUpperCase();
      const files = groups.get(bookKey) || [];
      files.push(path.join(dataDir, entry.name));
      groups.set(bookKey, files);
      return;
    }

    if (!entry.isDirectory()) {
      return;
    }

    const dirPath = path.join(dataDir, entry.name);
    const files = fs.readdirSync(dirPath)
      .filter((name) => name.toLowerCase().endsWith(".json") && name.toLowerCase() !== "manifest.json")
      .map((name) => path.join(dirPath, name));

    if (!files.length) {
      return;
    }

    const bookKey = entry.name.toUpperCase();
    groups.set(bookKey, [...(groups.get(bookKey) || []), ...files]);
  });

  return [...groups.entries()]
    .map(([bookKey, files]) => ({
      key: bookKey,
      title: normalizeBookTitle(bookKey),
      files: files.sort()
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function loadEntriesForBook(book) {
  const recordsByWord = new Map();

  book.files.forEach((filePath) => {
    if (!fs.existsSync(filePath)) {
      throw new Error(`词书文件不存在: ${filePath}`);
    }

    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    items.forEach((item) => {
      const record = extractRecord(item, book.key);
      if (!record.word) {
        return;
      }

      const key = record.word.toLowerCase();
      if (!recordsByWord.has(key)) {
        recordsByWord.set(key, record);
        return;
      }

      recordsByWord.set(key, mergeRecords(recordsByWord.get(key), record));
    });
  });

  return [...recordsByWord.values()];
}

function hasTable(db, tableName) {
  const row = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName);

  return Boolean(row);
}

function getTableColumns(db, tableName) {
  if (!hasTable(db, tableName)) {
    return [];
  }
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function createBooksTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'builtin',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

function createWordsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_key TEXT NOT NULL,
      word TEXT NOT NULL,
      word_id TEXT NOT NULL,
      source_book_id TEXT NOT NULL,
      phonetic_uk TEXT DEFAULT '',
      phonetic_us TEXT DEFAULT '',
      meanings_json TEXT NOT NULL,
      translation_summary TEXT DEFAULT '',
      stage INTEGER NOT NULL DEFAULT 0,
      last_review_at TEXT,
      next_review_at TEXT,
      review_count INTEGER NOT NULL DEFAULT 0,
      wrong_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(book_key, word)
    );

    CREATE INDEX IF NOT EXISTS idx_words_book_key ON words(book_key);
    CREATE INDEX IF NOT EXISTS idx_words_next_review_at ON words(book_key, next_review_at);
    CREATE INDEX IF NOT EXISTS idx_words_last_review_at ON words(book_key, last_review_at);
  `);
}

function createReviewLogsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_entry_id INTEGER NOT NULL,
      book_key TEXT NOT NULL,
      studied_at TEXT NOT NULL,
      session_type TEXT NOT NULL CHECK (session_type IN ('new', 'review')),
      action TEXT NOT NULL CHECK (action IN ('unknown', 'vague', 'known')),
      previous_stage INTEGER NOT NULL DEFAULT 0,
      previous_last_review_at TEXT,
      previous_next_review_at TEXT,
      previous_review_count INTEGER NOT NULL DEFAULT 0,
      previous_wrong_count INTEGER NOT NULL DEFAULT 0,
      stage_after INTEGER NOT NULL,
      replaced_by_log_id INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY(word_entry_id) REFERENCES words(id)
    );

    CREATE INDEX IF NOT EXISTS idx_review_logs_studied_at ON review_logs(studied_at);
    CREATE INDEX IF NOT EXISTS idx_review_logs_word_entry_id ON review_logs(word_entry_id);
    CREATE INDEX IF NOT EXISTS idx_review_logs_book_key ON review_logs(book_key);
    CREATE INDEX IF NOT EXISTS idx_review_logs_replaced_by ON review_logs(replaced_by_log_id);
  `);
}

function createAppMetaTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);
}

function initializeSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS review_logs;
    DROP TABLE IF EXISTS words;
    DROP TABLE IF EXISTS books;
    DROP TABLE IF EXISTS app_meta;
  `);

  createBooksTable(db);
  createWordsTable(db);
  createReviewLogsTable(db);
  createAppMetaTable(db);
}

function ensureRuntimeSchema(db) {
  createBooksTable(db);
  createWordsTable(db);
  createReviewLogsTable(db);
  createAppMetaTable(db);
}

function getCurrentBookKey(db) {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(APP_META_CURRENT_BOOK_KEY);
  return row?.value ? String(row.value).toUpperCase() : null;
}

function getStoredSchemaVersion(db) {
  if (!hasTable(db, "app_meta")) {
    return null;
  }

  const row = db.prepare("SELECT value FROM app_meta WHERE key = ?").get(APP_META_SCHEMA_VERSION);
  if (!row?.value) {
    return null;
  }

  const version = Number(row.value);
  return Number.isFinite(version) ? version : null;
}

function setSchemaVersion(db, version) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(APP_META_SCHEMA_VERSION, String(version));
}

function setCurrentBookKey(db, bookKey) {
  db.prepare(`
    INSERT INTO app_meta (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(APP_META_CURRENT_BOOK_KEY, String(bookKey || "").toUpperCase());
}

function upsertBook(db, book, sourceType = "builtin") {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO books (book_key, title, source_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(book_key) DO UPDATE SET
      title = excluded.title,
      source_type = excluded.source_type,
      updated_at = excluded.updated_at
  `).run(book.key, book.title, sourceType, now, now);
}

function importBookEntries(db, book) {
  upsertBook(db, book, "builtin");

  const existing = db.prepare("SELECT COUNT(*) AS count FROM words WHERE book_key = ?").get(book.key).count;
  if (existing > 0) {
    return existing;
  }

  const entries = loadEntriesForBook(book);
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO words (
      book_key,
      word,
      word_id,
      source_book_id,
      phonetic_uk,
      phonetic_us,
      meanings_json,
      translation_summary,
      stage,
      last_review_at,
      next_review_at,
      review_count,
      wrong_count,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, 0, ?, ?)
  `);

  entries.forEach((record) => {
    insert.run(
      record.book_key,
      record.word,
      record.word_id,
      record.source_book_id,
      record.phonetic_uk,
      record.phonetic_us,
      JSON.stringify(record.meanings),
      record.translation_summary,
      now,
      now
    );
  });

  return entries.length;
}

function buildDatabase({ dbPath, dataDir }) {
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  const books = discoverBooks(dataDir);
  if (!books.length) {
    throw new Error(`未在 ${dataDir} 中找到可用词书数据`);
  }

  const db = new DatabaseSync(dbPath);

  try {
    initializeSchema(db);
    db.exec("BEGIN");
    try {
      books.forEach((book) => {
        importBookEntries(db, book);
      });
      setCurrentBookKey(db, books[0].key);
      setSchemaVersion(db, SCHEMA_VERSION);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }

  return books.length;
}

function rowToWord(row) {
  const isNewWord = !row.last_review_at;

  return {
    id: row.id,
    book_key: row.book_key,
    word: row.word,
    source_book_id: row.source_book_id,
    phonetic_uk: row.phonetic_uk,
    phonetic_us: row.phonetic_us,
    translation_summary: row.translation_summary,
    meanings: JSON.parse(row.meanings_json || "[]"),
    stage: row.stage,
    review_count: row.review_count,
    wrong_count: row.wrong_count,
    is_new_word: isNewWord,
    task_type: isNewWord ? "new" : "review"
  };
}

function computeNextReview(stage, action, isNewWord) {
  const maxStage = INTERVALS_MS.length - 1;
  let newStage = stage;
  let wrongIncrement = 0;

  if (action === "unknown") {
    newStage = 0;
    wrongIncrement = 1;
  } else if (action === "vague") {
    newStage = Math.min(Math.max(stage, 0) + 1, maxStage);
  } else if (action === "known") {
    newStage = isNewWord ? 1 : Math.min(Math.max(stage, 0) + 2, maxStage);
  } else {
    throw new Error("不支持的学习反馈");
  }

  return {
    newStage,
    wrongIncrement,
    nextReviewAt: new Date(Date.now() + INTERVALS_MS[newStage]).toISOString()
  };
}

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function detectLegacyBookKey(db) {
  if (!hasTable(db, "words")) {
    return "CET6";
  }

  const row = db.prepare("SELECT book_id FROM words ORDER BY id ASC LIMIT 1").get();
  const raw = String(row?.book_id || "").trim();
  const match = /^([A-Za-z0-9]+)/.exec(raw);
  return (match?.[1] || "CET6").toUpperCase();
}

function migrateLegacySchemaToV2(db, booksByKey) {
  const legacyBookKey = detectLegacyBookKey(db);
  const legacyWords = db.prepare(`
    SELECT
      id,
      word,
      word_id,
      book_id,
      phonetic_uk,
      phonetic_us,
      meanings_json,
      translation_summary,
      stage,
      last_review_at,
      next_review_at,
      review_count,
      wrong_count,
      created_at,
      updated_at
    FROM words
    ORDER BY id ASC
  `).all();

  const legacyLogs = hasTable(db, "review_logs")
    ? db.prepare(`
      SELECT
        id,
        word_id,
        studied_at,
        session_type,
        action,
        previous_stage,
        previous_last_review_at,
        previous_next_review_at,
        previous_review_count,
        previous_wrong_count,
        stage_after,
        replaced_by_log_id,
        created_at
      FROM review_logs
      ORDER BY id ASC
    `).all()
    : [];

  initializeSchema(db);

  const now = new Date().toISOString();
  const book = booksByKey.get(legacyBookKey) || {
    key: legacyBookKey,
    title: normalizeBookTitle(legacyBookKey)
  };
  upsertBook(db, book, "builtin");
  setCurrentBookKey(db, legacyBookKey);
  setSchemaVersion(db, 2);

  const insertWord = db.prepare(`
    INSERT INTO words (
      id,
      book_key,
      word,
      word_id,
      source_book_id,
      phonetic_uk,
      phonetic_us,
      meanings_json,
      translation_summary,
      stage,
      last_review_at,
      next_review_at,
      review_count,
      wrong_count,
      created_at,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  legacyWords.forEach((row) => {
    insertWord.run(
      row.id,
      legacyBookKey,
      row.word,
      row.word_id,
      row.book_id,
      row.phonetic_uk || "",
      row.phonetic_us || "",
      row.meanings_json || "[]",
      row.translation_summary || "",
      Number(row.stage) || 0,
      row.last_review_at || null,
      row.next_review_at || null,
      Number(row.review_count) || 0,
      Number(row.wrong_count) || 0,
      row.created_at || now,
      row.updated_at || now
    );
  });

  const insertLog = db.prepare(`
    INSERT INTO review_logs (
      id,
      word_entry_id,
      book_key,
      studied_at,
      session_type,
      action,
      previous_stage,
      previous_last_review_at,
      previous_next_review_at,
      previous_review_count,
      previous_wrong_count,
      stage_after,
      replaced_by_log_id,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  legacyLogs.forEach((row) => {
    insertLog.run(
      row.id,
      row.word_id,
      legacyBookKey,
      row.studied_at,
      row.session_type,
      row.action,
      Number(row.previous_stage) || 0,
      row.previous_last_review_at || null,
      row.previous_next_review_at || null,
      Number(row.previous_review_count) || 0,
      Number(row.previous_wrong_count) || 0,
      Number(row.stage_after) || 0,
      row.replaced_by_log_id || null,
      row.created_at || row.studied_at || now
    );
  });

}

function inferSchemaVersion(db) {
  const wordColumns = new Set(getTableColumns(db, "words"));
  if (!wordColumns.size) {
    return 0;
  }

  if (wordColumns.has("book_key")) {
    return 2;
  }

  return 1;
}

function migrateDatabase(db, booksByKey) {
  let version = getStoredSchemaVersion(db);
  if (version == null) {
    version = inferSchemaVersion(db);
  }

  if (version >= SCHEMA_VERSION) {
    return version;
  }

  if (version === 0) {
    initializeSchema(db);
    setSchemaVersion(db, SCHEMA_VERSION);
    return SCHEMA_VERSION;
  }

  if (version === 1) {
    migrateLegacySchemaToV2(db, booksByKey);
    return SCHEMA_VERSION;
  }

  throw new Error(`Unsupported schema version: ${version}`);
}

function ensureBooksImported(db, books) {
  db.exec("BEGIN");
  try {
    books.forEach((book) => {
      importBookEntries(db, book);
    });
    if (!getCurrentBookKey(db)) {
      setCurrentBookKey(db, books[0].key);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function validateImportPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("导入文件格式无效");
  }
  if (!Array.isArray(payload.books) || !Array.isArray(payload.words) || !Array.isArray(payload.review_logs)) {
    throw new Error("导入文件缺少必要的数据表");
  }
}

function createStore({ dbPath, dataDir }) {
  if (!fs.existsSync(dbPath)) {
    buildDatabase({ dbPath, dataDir });
  }

  const books = discoverBooks(dataDir);
  const booksByKey = new Map(books.map((book) => [book.key, book]));
  let db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");

  const migratedVersion = migrateDatabase(db, booksByKey);
  if (migratedVersion < SCHEMA_VERSION) {
    throw new Error(`Schema migration failed. Current version: ${migratedVersion}`);
  }
  if (getStoredSchemaVersion(db) !== SCHEMA_VERSION) {
    db.close();
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
  }

  ensureRuntimeSchema(db);
  setSchemaVersion(db, SCHEMA_VERSION);
  ensureBooksImported(db, books);

  const api = {
    buildDatabase() {
      db.close();
      buildDatabase({ dbPath, dataDir });
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      ensureRuntimeSchema(db);
      setSchemaVersion(db, SCHEMA_VERSION);
      ensureBooksImported(db, books);
      return books.length;
    },

    listBooks() {
      const rows = db.prepare(`
        SELECT
          b.book_key,
          b.title,
          b.source_type,
          COUNT(w.id) AS total_words,
          SUM(CASE WHEN w.last_review_at IS NOT NULL THEN 1 ELSE 0 END) AS learned_words,
          SUM(CASE WHEN w.last_review_at IS NULL THEN 1 ELSE 0 END) AS new_words
        FROM books b
        LEFT JOIN words w ON w.book_key = b.book_key
        GROUP BY b.book_key, b.title, b.source_type
        ORDER BY b.book_key ASC
      `).all();

      const currentBookKey = getCurrentBookKey(db);
      return rows.map((row) => ({
        key: row.book_key,
        title: row.title,
        source_type: row.source_type,
        total_words: row.total_words || 0,
        learned_words: row.learned_words || 0,
        new_words: row.new_words || 0,
        is_current: row.book_key === currentBookKey
      }));
    },

    getCurrentBook() {
      const currentBookKey = getCurrentBookKey(db);
      const row = db.prepare(`
        SELECT
          b.book_key,
          b.title,
          b.source_type,
          COUNT(w.id) AS total_words,
          SUM(CASE WHEN w.last_review_at IS NOT NULL THEN 1 ELSE 0 END) AS learned_words,
          SUM(CASE WHEN w.last_review_at IS NULL THEN 1 ELSE 0 END) AS new_words
        FROM books b
        LEFT JOIN words w ON w.book_key = b.book_key
        WHERE b.book_key = ?
        GROUP BY b.book_key, b.title, b.source_type
      `).get(currentBookKey);

      if (row) {
        return {
          key: row.book_key,
          title: row.title,
          source_type: row.source_type,
          total_words: row.total_words || 0,
          learned_words: row.learned_words || 0,
          new_words: row.new_words || 0
        };
      }

      return null;
    },

    switchBook(bookKey) {
      const normalized = String(bookKey || "").toUpperCase();
      const book = booksByKey.get(normalized);
      if (!book) {
        throw new Error(`未找到词书: ${bookKey}`);
      }

      db.exec("BEGIN");
      try {
        importBookEntries(db, book);
        setCurrentBookKey(db, normalized);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return this.getCurrentBook();
    },

    getTodayTasks(limit = 30) {
      const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 200);
      const now = new Date().toISOString();
      const currentBookKey = getCurrentBookKey(db);

      const reviewRows = db.prepare(`
        SELECT *
        FROM words
        WHERE book_key = ?
          AND last_review_at IS NOT NULL
          AND next_review_at IS NOT NULL
          AND next_review_at <= ?
        ORDER BY next_review_at ASC
        LIMIT ?
      `).all(currentBookKey, now, safeLimit);

      const remainingSlots = Math.max(safeLimit - reviewRows.length, 0);
      let newRows = [];
      if (remainingSlots > 0) {
        newRows = db.prepare(`
          SELECT *
          FROM words
          WHERE book_key = ?
            AND last_review_at IS NULL
          ORDER BY RANDOM()
          LIMIT ?
        `).all(currentBookKey, remainingSlots);
      }

      const items = shuffle([...reviewRows, ...newRows]).map(rowToWord);
      return {
        items,
        total: items.length,
        review_count: reviewRows.length,
        new_count: newRows.length
      };
    },

    updateStatus(wordId, action, replaceReviewLogId = null) {
      const currentRow = db.prepare("SELECT * FROM words WHERE id = ?").get(wordId);
      if (!currentRow) {
        throw new Error("单词不存在");
      }

      const previousState = {
        stage: currentRow.stage,
        last_review_at: currentRow.last_review_at,
        next_review_at: currentRow.next_review_at,
        review_count: currentRow.review_count,
        wrong_count: currentRow.wrong_count
      };

      let sessionType = !currentRow.last_review_at ? "new" : "review";

      if (replaceReviewLogId) {
        const previousLog = db.prepare(`
          SELECT *
          FROM review_logs
          WHERE id = ? AND word_entry_id = ?
        `).get(replaceReviewLogId, wordId);

        if (!previousLog) {
          throw new Error("找不到需要覆盖的学习记录");
        }

        previousState.stage = previousLog.previous_stage ?? 0;
        previousState.last_review_at = previousLog.previous_last_review_at ?? null;
        previousState.next_review_at = previousLog.previous_next_review_at ?? null;
        previousState.review_count = previousLog.previous_review_count ?? 0;
        previousState.wrong_count = previousLog.previous_wrong_count ?? 0;
        sessionType = previousLog.session_type || (!previousState.last_review_at ? "new" : "review");
      }

      const isNewWord = sessionType === "new";
      const { newStage, wrongIncrement, nextReviewAt } = computeNextReview(previousState.stage, action, isNewWord);
      const reviewedAt = new Date().toISOString();

      db.exec("BEGIN");
      try {
        db.prepare(`
          UPDATE words
          SET stage = ?,
              last_review_at = ?,
              next_review_at = ?,
              review_count = ?,
              wrong_count = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          newStage,
          reviewedAt,
          nextReviewAt,
          previousState.review_count + 1,
          previousState.wrong_count + wrongIncrement,
          reviewedAt,
          wordId
        );

        const logResult = db.prepare(`
          INSERT INTO review_logs (
            word_entry_id,
            book_key,
            studied_at,
            session_type,
            action,
            previous_stage,
            previous_last_review_at,
            previous_next_review_at,
            previous_review_count,
            previous_wrong_count,
            stage_after,
            replaced_by_log_id,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(
          wordId,
          currentRow.book_key,
          reviewedAt,
          sessionType,
          action,
          previousState.stage,
          previousState.last_review_at,
          previousState.next_review_at,
          previousState.review_count,
          previousState.wrong_count,
          newStage,
          reviewedAt
        );

        const reviewLogId = Number(logResult.lastInsertRowid);
        if (replaceReviewLogId) {
          db.prepare(`
            UPDATE review_logs
            SET replaced_by_log_id = ?
            WHERE id = ?
          `).run(reviewLogId, replaceReviewLogId);
        }

        db.exec("COMMIT");

        return {
          ok: true,
          stage: newStage,
          next_review_at: nextReviewAt,
          task_type: sessionType,
          review_log_id: reviewLogId
        };
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    getStats() {
      const currentBookKey = getCurrentBookKey(db);
      const today = db.prepare(`
        SELECT
          COUNT(DISTINCT CASE WHEN rl.session_type = 'new' THEN rl.word_entry_id END) AS today_new_words,
          COUNT(DISTINCT CASE WHEN rl.session_type = 'review' THEN rl.word_entry_id END) AS today_review_words,
          COUNT(DISTINCT rl.word_entry_id) AS today_study_words
        FROM review_logs rl
        WHERE rl.book_key = ?
          AND rl.replaced_by_log_id IS NULL
          AND date(rl.studied_at, 'localtime') = date('now', 'localtime')
      `).get(currentBookKey);

      const currentBook = this.getCurrentBook();
      return {
        total_words: db.prepare("SELECT COUNT(*) AS count FROM words WHERE book_key = ?").get(currentBookKey).count,
        current_book: currentBook?.key || currentBookKey,
        current_book_title: currentBook?.title || currentBookKey,
        learned_words: today.today_study_words || 0,
        learned_words_total: db.prepare("SELECT COUNT(*) AS count FROM words WHERE book_key = ? AND last_review_at IS NOT NULL").get(currentBookKey).count,
        new_words: db.prepare("SELECT COUNT(*) AS count FROM words WHERE book_key = ? AND last_review_at IS NULL").get(currentBookKey).count,
        due_words: db.prepare(`
          SELECT COUNT(*) AS count
          FROM words
          WHERE book_key = ?
            AND last_review_at IS NOT NULL
            AND next_review_at IS NOT NULL
            AND date(next_review_at, 'localtime') <= date('now', 'localtime')
        `).get(currentBookKey).count,
        mastered_words: db.prepare("SELECT COUNT(*) AS count FROM words WHERE book_key = ? AND stage >= ?").get(currentBookKey, INTERVALS_MS.length - 1).count,
        today_new_words: today.today_new_words || 0,
        today_review_words: today.today_review_words || 0
      };
    },

    getDueProjection(days = 90) {
      const currentBookKey = getCurrentBookKey(db);
      const totalDays = Math.min(Math.max(Number(days) || 90, 1), 365);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const result = [];
      const projectionMap = new Map();
      const horizonEnd = new Date(today);
      horizonEnd.setDate(horizonEnd.getDate() + totalDays - 1);

      const rows = db.prepare(`
        SELECT
          stage,
          last_review_at,
          next_review_at
        FROM words
        WHERE book_key = ?
          AND last_review_at IS NOT NULL
          AND next_review_at IS NOT NULL
      `).all(currentBookKey);

      const addProjection = (date) => {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
          return;
        }

        const clampedDate = date < today ? new Date(today) : date;
        if (clampedDate > horizonEnd) {
          return;
        }

        const key = formatLocalDateKey(clampedDate);
        projectionMap.set(key, (projectionMap.get(key) || 0) + 1);
      };

      rows.forEach((row) => {
        const stage = Math.min(Math.max(Number(row.stage) || 0, 0), INTERVALS_MS.length - 1);
        const lastReviewAt = row.last_review_at ? new Date(row.last_review_at) : null;
        const nextReviewAt = row.next_review_at ? new Date(row.next_review_at) : null;

        if (!nextReviewAt || Number.isNaN(nextReviewAt.getTime())) {
          return;
        }

        addProjection(nextReviewAt);

        if (!lastReviewAt || Number.isNaN(lastReviewAt.getTime())) {
          return;
        }

        for (let futureStage = stage + 1; futureStage < INTERVALS_MS.length; futureStage += 1) {
          addProjection(new Date(lastReviewAt.getTime() + INTERVALS_MS[futureStage]));
        }
      });

      for (let offset = 0; offset < totalDays; offset += 1) {
        const date = new Date(today);
        date.setDate(today.getDate() + offset);
        const key = formatLocalDateKey(date);
        result.push({
          date: key,
          count: projectionMap.get(key) || 0
        });
      }

      return result;
    },

    getStudyActivity() {
      const currentBookKey = getCurrentBookKey(db);
      const rows = db.prepare(`
        SELECT
          day AS date,
          COUNT(DISTINCT CASE WHEN session_type = 'new' THEN word_entry_id END) AS new_words,
          COUNT(DISTINCT CASE WHEN session_type = 'review' THEN word_entry_id END) AS review_words,
          COUNT(DISTINCT word_entry_id) AS study_words
        FROM (
          SELECT
            word_entry_id,
            session_type,
            date(studied_at, 'localtime') AS day
          FROM review_logs
          WHERE book_key = ?
            AND replaced_by_log_id IS NULL
        )
        GROUP BY day
        ORDER BY day ASC
      `).all(currentBookKey);

      return rows.map((row) => ({
        date: row.date,
        new_words: row.new_words || 0,
        review_words: row.review_words || 0,
        study_words: row.study_words || 0
      }));
    },

    exportData(appVersion = "1.1.3") {
      return {
        schema_version: SCHEMA_VERSION,
        app_version: appVersion,
        exported_at: new Date().toISOString(),
        current_book_key: getCurrentBookKey(db),
        books: db.prepare("SELECT * FROM books ORDER BY book_key ASC").all(),
        words: db.prepare("SELECT * FROM words ORDER BY id ASC").all(),
        review_logs: db.prepare("SELECT * FROM review_logs ORDER BY id ASC").all(),
        app_meta: db.prepare("SELECT * FROM app_meta ORDER BY key ASC").all()
      };
    },

    importData(payload) {
      validateImportPayload(payload);
      const booksToImport = Array.isArray(payload.books) ? payload.books : [];
      const wordsToImport = Array.isArray(payload.words) ? payload.words : [];
      const logsToImport = Array.isArray(payload.review_logs) ? payload.review_logs : [];
      const appMetaToImport = Array.isArray(payload.app_meta) ? payload.app_meta : [];

      db.exec("BEGIN");
      try {
        initializeSchema(db);

        const insertBook = db.prepare(`
          INSERT INTO books (id, book_key, title, source_type, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);
        booksToImport.forEach((row, index) => {
          insertBook.run(
            row.id || index + 1,
            String(row.book_key || "").toUpperCase(),
            row.title || normalizeBookTitle(String(row.book_key || "").toUpperCase()),
            row.source_type || "builtin",
            row.created_at || new Date().toISOString(),
            row.updated_at || new Date().toISOString()
          );
        });

        const insertWord = db.prepare(`
          INSERT INTO words (
            id,
            book_key,
            word,
            word_id,
            source_book_id,
            phonetic_uk,
            phonetic_us,
            meanings_json,
            translation_summary,
            stage,
            last_review_at,
            next_review_at,
            review_count,
            wrong_count,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        wordsToImport.forEach((row, index) => {
          insertWord.run(
            row.id || index + 1,
            String(row.book_key || "").toUpperCase(),
            row.word,
            row.word_id || "",
            row.source_book_id || "",
            row.phonetic_uk || "",
            row.phonetic_us || "",
            row.meanings_json || "[]",
            row.translation_summary || "",
            Number(row.stage) || 0,
            row.last_review_at || null,
            row.next_review_at || null,
            Number(row.review_count) || 0,
            Number(row.wrong_count) || 0,
            row.created_at || new Date().toISOString(),
            row.updated_at || new Date().toISOString()
          );
        });

        const insertLog = db.prepare(`
          INSERT INTO review_logs (
            id,
            word_entry_id,
            book_key,
            studied_at,
            session_type,
            action,
            previous_stage,
            previous_last_review_at,
            previous_next_review_at,
            previous_review_count,
            previous_wrong_count,
            stage_after,
            replaced_by_log_id,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        logsToImport.forEach((row, index) => {
          insertLog.run(
            row.id || index + 1,
            row.word_entry_id,
            String(row.book_key || "").toUpperCase(),
            row.studied_at,
            row.session_type,
            row.action,
            Number(row.previous_stage) || 0,
            row.previous_last_review_at || null,
            row.previous_next_review_at || null,
            Number(row.previous_review_count) || 0,
            Number(row.previous_wrong_count) || 0,
            Number(row.stage_after) || 0,
            row.replaced_by_log_id || null,
            row.created_at || row.studied_at || new Date().toISOString()
          );
        });

        const insertMeta = db.prepare(`
          INSERT INTO app_meta (key, value)
          VALUES (?, ?)
        `);
        appMetaToImport.forEach((row) => {
          if (row?.key != null && row?.value != null) {
            insertMeta.run(String(row.key), String(row.value));
          }
        });

        if (!getCurrentBookKey(db)) {
          const fallbackBookKey = String(payload.current_book_key || booksToImport[0]?.book_key || books[0]?.key || "CET6").toUpperCase();
          setCurrentBookKey(db, fallbackBookKey);
        }

        setSchemaVersion(db, Number(payload.schema_version) || SCHEMA_VERSION);
        ensureBooksImported(db, books);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }

      return {
        ok: true,
        current_book_key: getCurrentBookKey(db),
        imported_books: db.prepare("SELECT COUNT(*) AS count FROM books").get().count,
        imported_words: db.prepare("SELECT COUNT(*) AS count FROM words").get().count,
        imported_logs: db.prepare("SELECT COUNT(*) AS count FROM review_logs").get().count
      };
    },

    close() {
      db.close();
    }
  };

  return api;
}

module.exports = {
  buildDatabase,
  createStore,
  discoverBooks,
  INTERVALS_MS
};
