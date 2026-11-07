
const fs = require("fs");
const path = require("path");
const moment = require("moment-timezone");

// ============================================================
// DATA PATHS
// ============================================================

const DATA_DIR = path.join(process.cwd(), "data");

const BANNED_GROUPS_FILE = path.join(
  DATA_DIR,
  "banned.json"
);

const BANNED_USERS_FILE = path.join(
  DATA_DIR,
  "banned_users.json"
);

const STOP_FILE = path.join(
  DATA_DIR,
  "stop.json"
);

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

// ============================================================
// EXECUTION PROTECTION
// ============================================================

const commandExecuted = new Set();

// ============================================================
// SAFE JSON
// ============================================================

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) {
      return {};
    }

    const content = fs
      .readFileSync(file, "utf8")
      .trim();

    if (!content) {
      return {};
    }

    const data = JSON.parse(content);

    if (
      data &&
      typeof data === "object" &&
      !Array.isArray(data)
    ) {
      return data;
    }

    return {};
  } catch (error) {
    console.error(
      "[JSON ERROR]",
      file,
      error.message
    );

    return {};
  }
}

// ============================================================
// BAN DATA SYNC
// ============================================================

function syncBanData() {
  try {
    if (
      global.data &&
      global.data.threadBanned &&
      typeof global.data.threadBanned.clear === "function"
    ) {
      const groups = readJSON(
        BANNED_GROUPS_FILE
      );

      global.data.threadBanned.clear();

      for (const id of Object.keys(groups)) {
        const item = groups[id];

        if (
          item === true ||
          (
            item &&
            typeof item === "object" &&
            item.banned === true
          )
        ) {
          global.data.threadBanned.set(
            String(id),
            true
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[GROUP BAN SYNC]",
      error.message
    );
  }

  try {
    if (
      global.data &&
      global.data.userBanned &&
      typeof global.data.userBanned.clear === "function"
    ) {
      const users = readJSON(
        BANNED_USERS_FILE
      );

      global.data.userBanned.clear();

      for (const id of Object.keys(users)) {
        const item = users[id];

        if (
          item === true ||
          (
            item &&
            typeof item === "object" &&
            item.banned === true
          )
        ) {
          global.data.userBanned.set(
            String(id),
            true
          );
        }
      }
    }
  } catch (error) {
    console.error(
      "[USER BAN SYNC]",
      error.message
    );
  }
}

// ============================================================
// RESTRICT CHECK
// ============================================================

function isGroupRestricted(threadID) {
  try {
    const data =
      readJSON(STOP_FILE);

    const item =
      data[String(threadID)];

    return Boolean(
      item &&
      typeof item === "object" &&
      item.active === true
    );

  } catch (error) {

    console.error(
      "[RESTRICT CHECK]",
      error.message
    );

    return false;
  }
}

// ============================================================
// COMMAND NORMALIZER
// ============================================================

function normalizeCommand(text) {
  return String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ـ/g, "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, "");
}

// ============================================================
// LEVENSHTEIN
// ============================================================

function levenshtein(a, b) {
  a = String(a);
  b = String(b);

  const matrix = Array.from(
    {
      length: b.length + 1
    },
    () => Array(a.length + 1).fill(0)
  );

  for (let i = 0; i <= b.length; i++) {
    matrix[i][0] = i;
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {

      if (b[i - 1] === a[j - 1]) {

        matrix[i][j] =
          matrix[i - 1][j];

      } else {

        matrix[i][j] =
          Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + 1
          );
      }
    }
  }

  return matrix[b.length][a.length];
}

// ============================================================
// SIMILARITY
// ============================================================

function similarityScore(input, command) {
  input = normalizeCommand(input);
  command = normalizeCommand(command);

  if (!input || !command) {
    return 0;
  }

  if (input === command) {
    return 1;
  }

  if (
    command.startsWith(input) ||
    input.startsWith(command)
  ) {

    const shorter = Math.min(
      input.length,
      command.length
    );

    const longer = Math.max(
      input.length,
      command.length
    );

    return (
      0.75 +
      (shorter / longer) * 0.25
    );
  }

  const distance = levenshtein(
    input,
    command
  );

  const maxLength = Math.max(
    input.length,
    command.length
  );

  return maxLength
    ? 1 - distance / maxLength
    : 0;
}

// ============================================================
// CLOSEST COMMAND
// ============================================================

function findClosestCommand(input, commands) {
  let bestCommand = null;
  let bestScore = 0;

  for (const command of commands) {

    const score =
      similarityScore(
        input,
        command
      );

    if (score > bestScore) {
      bestScore = score;
      bestCommand = command;
    }
  }

  return {
    command: bestCommand,
    score: bestScore
  };
}

// ============================================================
// NORMALIZE MENTIONS
// ============================================================

function normalizeMentions(event) {

  if (!event) {
    return;
  }

  let mentions = event.mentions;

  if (!mentions) {
    event.mentions = {};
    event.mentionIDs = [];
    event.mentionID = null;
  }

  else if (mentions instanceof Map) {

    const converted = {};

    for (
      const [id, value]
      of mentions.entries()
    ) {

      if (!id) {
        continue;
      }

      converted[String(id)] = value;
    }

    mentions = converted;
  }

  if (
    typeof mentions !== "object" ||
    Array.isArray(mentions)
  ) {
    mentions = {};
  }

  const normalized = {};

  for (
    const [id, value]
    of Object.entries(mentions)
  ) {

    if (!id) {
      continue;
    }

    const uid =
      String(id).trim();

    if (!uid) {
      continue;
    }

    normalized[uid] = value;
  }

  event.mentions =
    normalized;

  event.mentionIDs =
    Object.keys(normalized);

  event.mentionID =
    event.mentionIDs.length > 0
      ? String(event.mentionIDs[0])
      : null;

  if (
    event.messageReply &&
    event.messageReply.senderID
  ) {

    event.messageReply.senderID =
      String(event.messageReply.senderID);
  }
}

// ============================================================
// FIRST MENTION
// ============================================================

function getFirstMention(event) {

  normalizeMentions(event);

  if (
    event &&
    event.mentionID
  ) {
    return String(event.mentionID);
  }

  const ids =
    Object.keys(event?.mentions || {});

  return ids.length
    ? String(ids[0])
    : null;
}

// ============================================================
// DEVELOPERS
// ============================================================

function getDeveloperIDs() {

  const ids = [];

  try {

    if (
      Array.isArray(global.config?.ADMINBOT)
    ) {

      for (const id of global.config.ADMINBOT) {

        if (id) {
          ids.push(String(id));
        }
      }
    }

  } catch (e) {}

  try {

    const dev =
      global.config?.KIRA_CONF?.dev;

    if (dev) {
      ids.push(String(dev));
    }

  } catch (e) {}

  return [
    ...new Set(ids)
  ];
}

function isDeveloper(senderID) {

  return getDeveloperIDs()
    .includes(String(senderID));
}

// ============================================================
// BAN CHECK
// ============================================================

function isGroupBanned(threadID) {

  const data =
    readJSON(BANNED_GROUPS_FILE);

  const item =
    data[String(threadID)];

  return (
    item === true ||
    (
      item &&
      typeof item === "object" &&
      item.banned === true
    )
  );
}

function isUserBanned(senderID) {

  const data =
    readJSON(BANNED_USERS_FILE);

  const item =
    data[String(senderID)];

  return (
    item === true ||
    (
      item &&
      typeof item === "object" &&
      item.banned === true
    )
  );
}

// ============================================================
// TYPING INDICATOR
// ============================================================

async function setTyping(
  api,
  threadID,
  status
) {

  try {

    if (
      !api ||
      !threadID ||
      typeof api.sendTypingIndicator !== "function"
    ) {
      return false;
    }

    const id = String(threadID);

    try {

      const result =
        api.sendTypingIndicator(
          id,
          Boolean(status)
        );

      if (
        result &&
        typeof result.then === "function"
      ) {

        await Promise.race([

          result.catch(() => false),

          new Promise(resolve =>
            setTimeout(
              () => resolve(false),
              3000
            )
          )

        ]);
      }

      return true;

    } catch (error) {

      return false;
    }

  } catch (error) {

    return false;
  }
}

// ============================================================
// SEND MESSAGE SAFE
// ============================================================

async function sendMessage(
  api,
  message,
  threadID,
  messageID
) {

  try {

    if (
      !api ||
      typeof api.sendMessage !== "function"
    ) {
      return null;
    }

    return await new Promise(resolve => {

      let finished = false;

      const timer = setTimeout(() => {

        if (finished) {
          return;
        }

        finished = true;

        console.error(
          "[SEND MESSAGE TIMEOUT]"
        );

        resolve(null);

      }, 10000);

      const done = (error, info) => {

        if (finished) {
          return;
        }

        finished = true;

        clearTimeout(timer);

        if (error) {

          console.error(
            "[SEND MESSAGE ERROR]",
            error
          );
        }

        resolve(info || null);
      };

      try {

        api.sendMessage(
          message,
          threadID,
          done,
          messageID
        );

      } catch (error) {

        done(error, null);
      }
    });

  } catch (error) {

    console.error(
      "[SEND ERROR]",
      error.message
    );

    return null;
  }
}

// ============================================================
// GET THREAD INFO
// ============================================================

async function getThreadInfoSafe(
  api,
  Threads,
  threadInfo,
  threadID
) {

  const id = String(threadID);

  // ==========================================================
  // 1 - CACHE
  // ==========================================================

  try {

    const cached =
      threadInfo.get(id);

    if (
      cached &&
      Array.isArray(cached.adminIDs)
    ) {
      return cached;
    }

  } catch (e) {}

  // ==========================================================
  // 2 - THREADS CONTROLLER WITH TIMEOUT
  // ==========================================================

  if (
    Threads &&
    typeof Threads.getInfo === "function"
  ) {

    try {

      const info = await Promise.race([

        Promise.resolve().then(() =>
          Threads.getInfo(id)
        ),

        new Promise(resolve => {
          setTimeout(
            () => resolve(null),
            5000
          );
        })

      ]);

      if (info) {

        try {
          threadInfo.set(id, info);
        } catch (e) {}

        return info;
      }

    } catch (error) {

      console.error(
        "[THREAD INFO ERROR]",
        error.message
      );
    }
  }

  // ==========================================================
  // 3 - API WITH TIMEOUT
  // ==========================================================

  if (
    api &&
    typeof api.getThreadInfo === "function"
  ) {

    try {

      const info = await new Promise(resolve => {

        let finished = false;

        const timer = setTimeout(() => {

          if (finished) {
            return;
          }

          finished = true;
          resolve(null);

        }, 5000);

        const done = (error, result) => {

          if (finished) {
            return;
          }

          finished = true;

          clearTimeout(timer);

          if (error) {
            resolve(null);
            return;
          }

          resolve(result || null);
        };

        try {

          const result =
            api.getThreadInfo(id, done);

          if (
            result &&
            typeof result.then === "function"
          ) {

            result
              .then(data => done(null, data))
              .catch(error => done(error, null));
          }

        } catch (error) {

          done(error, null);
        }
      });

      if (info) {

        try {
          threadInfo.set(id, info);
        } catch (e) {}

        return info;
      }

    } catch (error) {

      console.error(
        "[API THREAD INFO ERROR]",
        error.message
      );
    }
  }

  return null;
}

// ============================================================
// MAIN HANDLER
// ============================================================

module.exports = function ({
  api,
  models,
  Users,
  Threads,
  Currencies
}) {

  syncBanData();

  return async function ({ event }) {

    if (!event) {
      return;
    }

    try {

      // ======================================================
      // NORMALIZE MENTIONS
      // ======================================================

      normalizeMentions(event);

      const config = global.config || {};
      const data = global.data || {};
      const client = global.client || {};

      const commands =
        client.commands || new Map();

      const threadInfo =
        data.threadInfo || new Map();

      const threadData =
        data.threadData || new Map();

      const commandBanned =
        data.commandBanned || new Map();

      const PREFIX = config.PREFIX || "";

      const DeveloperMode =
        config.DeveloperMode === true;

      const body = event.body;

      const senderID =
        String(event.senderID || "");

      const threadID =
        String(event.threadID || "");

      const messageID = event.messageID;

      if (
        !body ||
        !senderID ||
        !threadID
      ) {
        return;
      }

      // ======================================================
      // BAN SYNC
      // ======================================================

      syncBanData();

      // ======================================================
      // PREFIX
      // ======================================================

      const currentThreadData =
        threadData.get(threadID) || {};

      const prefix =
        Object.prototype.hasOwnProperty.call(
          currentThreadData,
          "PREFIX"
        )
          ? currentThreadData.PREFIX
          : PREFIX;

      if (!prefix) {
        return;
      }

      // ======================================================
      // BOT ID
      // ======================================================

      let botID = "";

      try {

        if (
          typeof api.getCurrentUserID === "function"
        ) {
          botID = String(api.getCurrentUserID());
        }

      } catch (e) {}

      // ======================================================
      // PREFIX REGEX
      // ======================================================

      const escapeRegex = str =>
        String(str).replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      const prefixPart =
        escapeRegex(prefix);

      let prefixRegex;

      if (botID) {

        prefixRegex = new RegExp(
          `^(<@!?${escapeRegex(botID)}>|${prefixPart})\\s*`,
          "i"
        );

      } else {

        prefixRegex = new RegExp(
          `^${prefixPart}\\s*`,
          "i"
        );
      }

      const prefixMatch =
        body.match(prefixRegex);

      if (!prefixMatch) {
        return;
      }

      const content =
        body.slice(prefixMatch[0].length).trim();

      if (!content) {
        return;
      }

      // ======================================================
      // COMMAND
      // ======================================================

      const parts = content.split(/\s+/);

      const commandNameRaw = parts.shift();

      const commandName =
        normalizeCommand(commandNameRaw);

      if (!commandName) {
        return;
      }

      let command = null;

      for (const [name, cmd] of commands.entries()) {

        if (
          normalizeCommand(name) === commandName
        ) {

          command = cmd;
          break;
        }
      }

      // ======================================================
      // DEVELOPER
      // ======================================================

      const developer =
        isDeveloper(senderID);

      // ======================================================
      // GROUP ADMIN
      // ======================================================

      const info =
        await getThreadInfoSafe(
          api,
          Threads,
          threadInfo,
          threadID
        );

      const admins =
        Array.isArray(info?.adminIDs)
          ? info.adminIDs
          : [];

      const isGroupAdmin =
        admins.some(admin => {

          if (
            typeof admin === "string" ||
            typeof admin === "number"
          ) {

            return String(admin) === senderID;
          }

          return (
            String(admin?.id || "") === senderID
          );
        });

      // ======================================================
      // DEVELOPER MODE
      // ======================================================

      if (
        DeveloperMode &&
        !developer
      ) {
        return;
      }

      // ======================================================
      // BAN CHECK
      // ======================================================

      if (!developer) {

        if (isGroupBanned(threadID)) {
          return;
        }

        if (isUserBanned(senderID)) {
          return;
        }
      }

      // ======================================================
      // RESTRICTED GROUP
      // ======================================================

      if (
        isGroupRestricted(threadID) &&
        !developer &&
        !isGroupAdmin
      ) {
        return;
      }

      // ======================================================
      // COMMAND NOT FOUND
      // ======================================================

      if (!command) {

        const names =
          Array.from(commands.keys());

        if (!names.length) {
          return;
        }

        const result =
          findClosestCommand(commandName, names);

        if (
          result.command &&
          result.score >= 0.55
        ) {

          return sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 UTILITY ━━ ⌬

❌ الأمر "${commandNameRaw}" غير موجود

💡 ربما تقصد:
"${result.command}"؟`,

            threadID,
            messageID
          );
        }

        return sendMessage(
          api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 UTILITY ━━ ⌬

❌ الأمر "${commandNameRaw}" غير موجود

💡 استخدم ${prefix}مساعدة لرؤية الأوامر.`,

          threadID,
          messageID
        );
      }

      // ======================================================
      // COMMAND CONFIG
      // ======================================================

      const commandConfig =
        command.config || {};

      // ======================================================
      // MENTIONS
      // ======================================================

      normalizeMentions(event);

      const firstMention =
        getFirstMention(event);

      if (
        DeveloperMode &&
        firstMention
      ) {

        console.log(
          "[HINA MENTION]",
          {
            senderID,
            mentionID: firstMention,
            allMentions: event.mentionIDs || [],
            command: commandName
          }
        );
      }

      // ======================================================
      // COMMAND BAN
      // ======================================================

      if (
        commandBanned &&
        !developer
      ) {

        const threadBannedCommands =
          commandBanned.get(threadID) || [];

        const userBannedCommands =
          commandBanned.get(senderID) || [];

        if (
          Array.isArray(threadBannedCommands) &&
          threadBannedCommands.includes(commandConfig.name)
        ) {

          return sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 ADMIN ━━ ⌬

🚫 الأمر محظور في هذه المجموعة

الأمر:
${commandConfig.name}`,

            threadID,
            messageID
          );
        }

        if (
          Array.isArray(userBannedCommands) &&
          userBannedCommands.includes(commandConfig.name)
        ) {

          return sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 ADMIN ━━ ⌬

⛔ أنت محظور من استخدام هذا الأمر`,

            threadID,
            messageID
          );
        }
      }

      // ======================================================
      // NSFW
      // ======================================================

      const category =
        String(
          commandConfig.commandCategory || ""
        ).toLowerCase();

      if (
        category === "nsfw" &&
        !(
          data.threadAllowNSFW instanceof Array
            ? data.threadAllowNSFW.includes(threadID)
            : false
        ) &&
        !developer
      ) {

        return sendMessage(
          api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 UTILITY ━━ ⌬

🔞 محتوى محظور في هذه المجموعة`,

          threadID,
          messageID
        );
      }

      // ======================================================
      // PERMISSION
      // ======================================================

      let permission = 0;

      if (developer) {

        permission = 2;

      } else if (isGroupAdmin) {

        permission = 1;
      }

      const requiredPermission =
        Number(
          commandConfig.hasPermssion ??
          commandConfig.hasPermission ??
          0
        );

      if (requiredPermission > permission) {

        return sendMessage(
          api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 ADMIN ━━ ⌬

⚠️ ليس لديك صلاحية لتنفيذ هذا الأمر`,

          threadID,
          messageID
        );
      }

      // ======================================================
      // COOLDOWN
      // ======================================================

      if (!client.cooldowns) {
        client.cooldowns = new Map();
      }

      if (!client.cooldowns.has(commandConfig.name)) {

        client.cooldowns.set(
          commandConfig.name,
          new Map()
        );
      }

      const timestamps =
        client.cooldowns.get(commandConfig.name);

      const cooldownSeconds =
        Number(commandConfig.cooldowns) || 1;

      const expirationTime =
        cooldownSeconds * 1000;

      const previous =
        timestamps.get(senderID);

      if (
        previous &&
        Date.now() < previous + expirationTime
      ) {

        try {

          if (
            typeof api.setMessageReaction === "function"
          ) {

            return api.setMessageReaction(
              "⏳",
              messageID,
              () => {},
              true
            );
          }

        } catch (e) {}

        return;
      }

      // ======================================================
      // DUPLICATE PROTECTION
      // ======================================================

      const commandKey =
        [
          threadID,
          senderID,
          commandName
        ].join("_");

      if (commandExecuted.has(commandKey)) {
        return;
      }

      commandExecuted.add(commandKey);

      setTimeout(() => {

        commandExecuted.delete(commandKey);

      }, 1500);

      // ======================================================
      // COMMAND OBJECT
      // ======================================================

      const Obj = {

        api,

        event,

        args: parts,

        models,

        Users,

        Threads,

        Currencies,

        permssion: permission,

        permission,

        mentionID:
          event.mentionID || firstMention,

        mentionIDs:
          event.mentionIDs || [],

        getText:
          global.getText ||
          function () {
            return "";
          }
      };

      // ======================================================
      // TYPING ON
      // ======================================================

      await setTyping(
        api,
        threadID,
        true
      );

      try {

        // ====================================================
        // RUN COMMAND
        // ====================================================

        if (typeof command.run === "function") {

          await command.run(Obj);
        }

      } catch (error) {

        console.error(
          `[${moment().format("HH:mm:ss")}] COMMAND ERROR:`,
          error
        );

        if (DeveloperMode) {

          await sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 DEVELOPER ━━ ⌁

❌ حدث خطأ أثناء تنفيذ الأمر

${error.message}`,

            threadID,
            messageID
          );

        } else {

          await sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 ━━ ⌁

❌ حدث خطأ أثناء تنفيذ الأمر`,

            threadID,
            messageID
          );
        }

      } finally {

        // ====================================================
        // TYPING OFF
        // ====================================================

        await setTyping(
          api,
          threadID,
          false
        );
      }

      // ======================================================
      // SAVE COOLDOWN
      // ======================================================

      timestamps.set(
        senderID,
        Date.now()
      );

    } catch (error) {

      console.error(
        `[${moment().format("HH:mm:ss")}] HANDLER ERROR:`,
        error
      );

      try {

        if (
          event?.threadID &&
          event?.messageID
        ) {

          await sendMessage(
            api,

`⌬ ━━ 𝗛𝗜𝗡𝗔 DEVELOPER ━━ ⌁

❌ حدث خطأ في معالجة الأمر

${error.message}`,

            String(event.threadID),
            event.messageID
          );
        }

      } catch (e) {

        console.error(
          "[FINAL ERROR]",
          e.message
        );
      }
    }
  };
};
