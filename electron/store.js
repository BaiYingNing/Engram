const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DATA_FILES = ["CET6_1.json", "CET6_2.json", "CET6_3.json"];
const INTERVALS_MS = [
  10 * 60 * 1000,
  1 * 24 * 60 * 60 * 1000,
  3 * 24 * 60 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000,
  15 * 24 * 60 * 60 * 1000,
  30 * 24 * 60 * 60 * 1000
];

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
    .split(/[；。+/]/)
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

function extractRecord(item) {
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
    word: String(item?.headWord || "").trim(),
    word_id: String(wordRoot.wordId || "").trim(),
    book_id: String(item?.bookId || "").trim(),
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
    word: preferred.word,
    word_id: preferred.word_id || fallback.word_id,
    book_id: preferred.book_id || fallback.book_id,
    phonetic_uk: preferred.phonetic_uk || fallback.phonetic_uk,
    phonetic_us: preferred.phonetic_us || fallback.phonetic_us,
    meanings,
    translation_summary: buildTranslationSummary(meanings)
  };
}

function loadEntries(dataDir) {
  const recordsByWord = new Map();

  DATA_FILES.forEach((fileName) => {
    const filePath = path.join(dataDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(`词库文件不存在: ${filePath}`);
    }

    const items = JSON.parse(fs.readFileSync(filePath, "utf8"));
    items.forEach((item) => {
      const record = extractRecord(item);
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

function createWordsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS words (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word TEXT NOT NULL UNIQUE,
      word_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
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
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_words_next_review_at ON words(next_review_at);
    CREATE INDEX IF NOT EXISTS idx_words_last_review_at ON words(last_review_at);
  `);
}

function createReviewLogsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      word_id INTEGER NOT NULL,
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
      FOREIGN KEY(word_id) REFERENCES words(id)
    );

    CREATE INDEX IF NOT EXISTS idx_review_logs_studied_at ON review_logs(studied_at);
    CREATE INDEX IF NOT EXISTS idx_review_logs_word_id ON review_logs(word_id);
  `);
}

function ensureReviewLogsColumns(db) {
  const columns = new Set(getTableColumns(db, "review_logs"));
  const additions = [
    ["previous_stage", "INTEGER NOT NULL DEFAULT 0"],
    ["previous_last_review_at", "TEXT"],
    ["previous_next_review_at", "TEXT"],
    ["previous_review_count", "INTEGER NOT NULL DEFAULT 0"],
    ["previous_wrong_count", "INTEGER NOT NULL DEFAULT 0"],
    ["replaced_by_log_id", "INTEGER"]
  ];

  additions.forEach(([column, definition]) => {
    if (!columns.has(column)) {
      db.exec(`ALTER TABLE review_logs ADD COLUMN ${column} ${definition}`);
    }
  });

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_review_logs_replaced_by
    ON review_logs(replaced_by_log_id)
  `);
}

function initializeSchema(db) {
  db.exec(`
    DROP TABLE IF EXISTS review_logs;
    DROP TABLE IF EXISTS words;
  `);

  createWordsTable(db);
  createReviewLogsTable(db);
}

function ensureRuntimeSchema(db) {
  createWordsTable(db);
  createReviewLogsTable(db);
  ensureReviewLogsColumns(db);
}

function buildDatabase({ dbPath, dataDir }) {
  const dbDir = path.dirname(dbPath);
  fs.mkdirSync(dbDir, { recursive: true });

  const records = loadEntries(dataDir);
  const now = new Date().toISOString();
  const db = new DatabaseSync(dbPath);

  try {
    initializeSchema(db);
    const insert = db.prepare(`
      INSERT INTO words (
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
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, 0, ?, ?)
    `);

    db.exec("BEGIN");
    try {
      records.forEach((record) => {
        insert.run(
          record.word,
          record.word_id,
          record.book_id,
          record.phonetic_uk,
          record.phonetic_us,
          JSON.stringify(record.meanings),
          record.translation_summary,
          now,
          now
        );
      });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }

  return records.length;
}

function rowToWord(row) {
  const isNewWord = !row.last_review_at;

  return {
    id: row.id,
    word: row.word,
    book_id: row.book_id,
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

function createStore({ dbPath, dataDir }) {
  if (!fs.existsSync(dbPath)) {
    buildDatabase({ dbPath, dataDir });
  }

  let db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");

  if (!hasTable(db, "words")) {
    db.close();
    buildDatabase({ dbPath, dataDir });
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL;");
  }

  ensureRuntimeSchema(db);

  return {
    buildDatabase() {
      db.close();
      const total = buildDatabase({ dbPath, dataDir });
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL;");
      ensureRuntimeSchema(db);
      return total;
    },

    getTodayTasks(limit = 30) {
      const safeLimit = Math.min(Math.max(Number(limit) || 30, 1), 200);
      const now = new Date().toISOString();

      const reviewRows = db.prepare(`
        SELECT *
        FROM words
        WHERE last_review_at IS NOT NULL
          AND next_review_at IS NOT NULL
          AND next_review_at <= ?
        ORDER BY next_review_at ASC
        LIMIT ?
      `).all(now, safeLimit);

      const remainingSlots = Math.max(safeLimit - reviewRows.length, 0);
      let newRows = [];
      if (remainingSlots > 0) {
        newRows = db.prepare(`
          SELECT *
          FROM words
          WHERE last_review_at IS NULL
          ORDER BY id ASC
          LIMIT ?
        `).all(remainingSlots);
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
          WHERE id = ? AND word_id = ?
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
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `).run(
          wordId,
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
      const now = new Date().toISOString();
      const today = db.prepare(`
        SELECT
          COUNT(DISTINCT CASE WHEN session_type = 'new' THEN word_id END) AS today_new_words,
          COUNT(DISTINCT CASE WHEN session_type = 'review' THEN word_id END) AS today_review_words,
          COUNT(DISTINCT word_id) AS today_study_words
        FROM review_logs
        WHERE replaced_by_log_id IS NULL
          AND date(studied_at, 'localtime') = date('now', 'localtime')
      `).get();

      return {
        total_words: db.prepare("SELECT COUNT(*) AS count FROM words").get().count,
        current_book: (() => {
          const row = db.prepare("SELECT book_id FROM words ORDER BY id ASC LIMIT 1").get();
          return String(row?.book_id || "CET6").split("_")[0] || "CET6";
        })(),
        learned_words: today.today_study_words || 0,
        learned_words_total: db.prepare("SELECT COUNT(*) AS count FROM words WHERE last_review_at IS NOT NULL").get().count,
        new_words: db.prepare("SELECT COUNT(*) AS count FROM words WHERE last_review_at IS NULL").get().count,
        due_words: db.prepare(`
          SELECT COUNT(*) AS count
          FROM words
          WHERE last_review_at IS NOT NULL
            AND next_review_at IS NOT NULL
            AND date(next_review_at, 'localtime') <= date('now', 'localtime')
        `).get().count,
        mastered_words: db.prepare("SELECT COUNT(*) AS count FROM words WHERE stage >= ?").get(INTERVALS_MS.length - 1).count,
        today_new_words: today.today_new_words || 0,
        today_review_words: today.today_review_words || 0
      };
    },

    getDueProjection(days = 90) {
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
        WHERE last_review_at IS NOT NULL
          AND next_review_at IS NOT NULL
      `).all();

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
      const rows = db.prepare(`
        SELECT
          day AS date,
          COUNT(DISTINCT CASE WHEN session_type = 'new' THEN word_id END) AS new_words,
          COUNT(DISTINCT CASE WHEN session_type = 'review' THEN word_id END) AS review_words,
          COUNT(DISTINCT word_id) AS study_words
        FROM (
          SELECT
            word_id,
            session_type,
            date(studied_at, 'localtime') AS day
          FROM review_logs
          WHERE replaced_by_log_id IS NULL
        )
        GROUP BY day
        ORDER BY day ASC
      `).all();

      return rows.map((row) => ({
        date: row.date,
        new_words: row.new_words || 0,
        review_words: row.review_words || 0,
        study_words: row.study_words || 0
      }));
    },

    close() {
      db.close();
    }
  };
}

module.exports = {
  buildDatabase,
  createStore,
  INTERVALS_MS
};
