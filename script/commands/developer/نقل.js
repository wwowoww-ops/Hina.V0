
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// =============================================
// HINA RECOVERY - 4.0.0
// حفظ واستعادة المجموعات بملفات محلية
// =============================================

module.exports.config = {
  name: "نقل",
  version: "4.0.0",
  hasPermssion: 0,
  credits: "أبو هريرة",
  description: "حفظ واستعادة المجموعات",
  commandCategory: "developer",
  usages: "نقل حفظ [الاسم] | نقل",
  cooldowns: 5
};

// =============================================
// الإعدادات
// =============================================

const MAX_RETRIES = 3;
const API_TIMEOUT = 30000;
const IMAGE_TIMEOUT = 20000;
const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

const STORAGE_DIR = path.join(__dirname, "HINA_RECOVERY");

const backups = Object.create(null);

fs.mkdirSync(STORAGE_DIR, { recursive: true });

// =============================================
// تحميل النسخ المحفوظة عند تشغيل البوت
// =============================================

function backupFile(name) {
  const id = Buffer.from(name, "utf8").toString("hex");
  return path.join(STORAGE_DIR, id + ".json");
}

function imageFile(name) {
  const id = Buffer.from(name, "utf8").toString("hex");
  return path.join(STORAGE_DIR, id + ".jpg");
}

function loadBackups() {
  try {
    const files = fs.readdirSync(STORAGE_DIR);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const filePath = path.join(STORAGE_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, "utf8"));

        if (!data || !data.name || !Array.isArray(data.members)) {
          continue;
        }

        data.busy = false;

        if (
          data.imageFile &&
          !fs.existsSync(path.join(STORAGE_DIR, data.imageFile))
        ) {
          data.imageFile = null;
        }

        backups[data.name] = data;

      } catch (error) {
        console.error("HINA BACKUP LOAD:", file, error);
      }
    }

  } catch (error) {
    console.error("HINA LOAD ERROR:", error);
  }
}

loadBackups();

// =============================================
// حفظ JSON بشكل آمن
// =============================================

function saveBackup(name, data) {
  const destination = backupFile(name);
  const temporary = destination + ".tmp";

  fs.writeFileSync(
    temporary,
    JSON.stringify(data, null, 2),
    "utf8"
  );

  fs.renameSync(temporary, destination);
}

// =============================================
// حذف النسخة بعد نجاح الاستعادة
// =============================================

function deleteBackup(name) {
  const data = backups[name];

  try {
    const json = backupFile(name);

    if (fs.existsSync(json)) {
      fs.unlinkSync(json);
    }

    const image = imageFile(name);

    if (fs.existsSync(image)) {
      fs.unlinkSync(image);
    }

    if (data?.imageFile) {
      const oldImage = path.join(STORAGE_DIR, data.imageFile);

      if (
        oldImage.startsWith(STORAGE_DIR + path.sep) &&
        fs.existsSync(oldImage)
      ) {
        fs.unlinkSync(oldImage);
      }
    }

    delete backups[name];

    return true;

  } catch (error) {
    console.error("HINA DELETE BACKUP:", error);
    return false;
  }
}

// =============================================
// أدوات مساعدة
// =============================================

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function errorMessage(error) {
  return error?.message || String(error || "خطأ غير معروف");
}

function isDeveloper(id) {
  const developers = (
    global.config?.ADMINBOT || []
  ).map(String);

  return developers.includes(String(id));
}

function getBotID(api) {
  return String(api.getCurrentUserID());
}

function getImageURL(info) {
  return (
    info?.imageSrc ||
    info?.threadPic ||
    info?.image ||
    null
  );
}

// =============================================
// استدعاء API
// =============================================

function callApi(api, method, args = [], timeout = API_TIMEOUT) {
  return new Promise((resolve, reject) => {

    if (typeof api[method] !== "function") {
      return reject(new Error(`الدالة ${method} غير مدعومة`));
    }

    let completed = false;

    const timer = setTimeout(() => {
      finish(new Error(`انتهت مهلة ${method}`));
    }, timeout);

    function finish(error, result) {
      if (completed) return;

      completed = true;
      clearTimeout(timer);

      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve(result);
      }
    }

    function callback(error, result) {
      if (arguments.length >= 2) {
        return finish(error, result);
      }

      if (error instanceof Error) {
        return finish(error);
      }

      finish(null, error);
    }

    try {
      const returned = api[method](...args, callback);

      if (returned && typeof returned.then === "function") {
        returned.then(
          result => finish(null, result),
          error => finish(error)
        );
      } else if (returned !== undefined) {
        finish(null, returned);
      }

    } catch (error) {
      finish(error);
    }
  });
}

// =============================================
// إرسال الرسائل
// =============================================

function send(api, message, threadID, replyToID = null) {
  return new Promise((resolve, reject) => {

    let completed = false;

    const timer = setTimeout(() => {
      finish(new Error("انتهت مهلة إرسال الرسالة"));
    }, API_TIMEOUT);

    function finish(error, result) {
      if (completed) return;

      completed = true;
      clearTimeout(timer);

      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      } else {
        resolve(result);
      }
    }

    function callback(error, result) {
      if (arguments.length >= 2) {
        return finish(error, result);
      }

      if (error instanceof Error) {
        return finish(error);
      }

      finish(null, error);
    }

    try {
      const returned = api.sendMessage(
        message,
        threadID,
        callback,
        replyToID
      );

      if (returned && typeof returned.then === "function") {
        returned.then(
          result => finish(null, result),
          error => finish(error)
        );
      } else if (returned !== undefined) {
        finish(null, returned);
      }

    } catch (error) {
      finish(error);
    }
  });
}

// =============================================
// إعادة المحاولة
// =============================================

async function retry(callback) {
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await callback(attempt);

      return {
        success: true,
        attempts: attempt,
        result
      };

    } catch (error) {
      lastError = error;

      console.error(
        `HINA RETRY ${attempt}/${MAX_RETRIES}:`,
        error
      );

      if (attempt < MAX_RETRIES) {
        await sleep(attempt * 1500);
      }
    }
  }

  return {
    success: false,
    attempts: MAX_RETRIES,
    error: errorMessage(lastError)
  };
}

// =============================================
// تنزيل الصورة
// =============================================

function downloadImage(url, redirects = 3) {
  return new Promise((resolve, reject) => {

    if (!url) {
      return reject(new Error("رابط الصورة غير موجود"));
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error("رابط الصورة غير صالح"));
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      return reject(new Error("نوع الرابط غير مدعوم"));
    }

    const client = parsed.protocol === "https:" ? https : http;

    const request = client.get(parsed, response => {

      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();

        if (redirects <= 0) {
          return reject(new Error("تجاوز عدد تحويلات الصورة"));
        }

        const next = new URL(response.headers.location, parsed).href;

        return resolve(downloadImage(next, redirects - 1));
      }

      if (response.statusCode !== 200) {
        response.resume();

        return reject(
          new Error(`فشل تحميل الصورة: ${response.statusCode}`)
        );
      }

      const chunks = [];
      let total = 0;

      response.on("data", chunk => {
        total += chunk.length;

        if (total > MAX_IMAGE_SIZE) {
          request.destroy(new Error("حجم الصورة تجاوز الحد المسموح"));
          return;
        }

        chunks.push(chunk);
      });

      response.on("end", () => {
        if (!total) {
          return reject(new Error("الصورة فارغة"));
        }

        resolve(Buffer.concat(chunks));
      });

      response.on("error", reject);
    });

    request.setTimeout(IMAGE_TIMEOUT, () => {
      request.destroy(new Error("انتهت مهلة تحميل الصورة"));
    });

    request.on("error", reject);
  });
}

// =============================================
// الحصول على معلومات الأعضاء
// =============================================

async function refreshMembers(api, threadID) {
  const info = await callApi(
    api,
    "getThreadInfo",
    [threadID]
  );

  if (!info) {
    throw new Error("لم تصل معلومات المجموعة");
  }

  return {
    info,
    members: new Set(
      (info.participantIDs || []).map(String)
    )
  };
}

// =============================================
// التحقق من نجاح تغيير الكنية
// =============================================

async function setNickname(api, nickname, threadID, memberID) {
  await callApi(
    api,
    "changeNickname",
    [
      nickname,
      threadID,
      memberID
    ]
  );
}

// =============================================
// استعادة صورة المجموعة
// =============================================

async function restoreImage(api, backup, name, threadID) {

  let localPath = null;

  if (backup.imageFile) {
    const candidate = path.join(STORAGE_DIR, backup.imageFile);

    if (fs.existsSync(candidate)) {
      localPath = candidate;
    }
  }

  // إذا لم توجد صورة محلية، نحاول تحميل الرابط القديم
  if (!localPath && backup.image) {
    const downloaded = await retry(async () => {
      const buffer = await downloadImage(backup.image);

      const destination = imageFile(name);
      fs.writeFileSync(destination, buffer);

      backup.imageFile = path.basename(destination);
      saveBackup(name, backup);

      return destination;
    });

    if (!downloaded.success) {
      return {
        success: false,
        attempts: downloaded.attempts,
        error: downloaded.error
      };
    }

    localPath = downloaded.result;
  }

  if (!localPath) {
    return {
      success: true,
      attempts: 0,
      details: "لا توجد صورة محفوظة"
    };
  }

  // نستخدم ملفاً فعلياً بدلاً من Readable.from
  const result = await retry(async () => {

    const stream = fs.createReadStream(localPath);

    try {
      await callApi(
        api,
        "changeGroupImage",
        [
          stream,
          threadID
        ]
      );
    } finally {
      stream.destroy();
    }
  });

  if (result.success) {
    return {
      success: true,
      attempts: result.attempts,
      details: "تم تنفيذ طلب تغيير الصورة"
    };
  }

  // محاولة إرسال الصورة كمرفق عند فشل تغييرها
  const attachment = await retry(async () => {

    const stream = fs.createReadStream(localPath);

    try {
      await send(
        api,
        {
          body:
            `🖼️ صورة المجموعة المحفوظة للنسخة: ${name}\n` +
            `تعذر تغيير الصورة تلقائياً.`,
          attachment: stream
        },
        threadID
      );
    } finally {
      stream.destroy();
    }
  });

  return {
    success: false,
    attempts: result.attempts,
    details: attachment.success
      ? "تعذر تغيير الصورة، لكن تم إرسال الملف كمرفق"
      : "تعذر تغيير الصورة وإرسال الملف كمرفق",
    error:
      result.error +
      (
        attachment.success
          ? ""
          : "\nفشل المرفق: " + attachment.error
      )
  };
}

// =============================================
// حفظ المجموعة
// =============================================

async function saveGroup(api, threadID, name) {

  const info = await callApi(
    api,
    "getThreadInfo",
    [threadID]
  );

  if (!info) {
    throw new Error("لم تصل معلومات المجموعة");
  }

  const members = (
    info.participantIDs || []
  ).map(String);

  const nicknames = {
    ...(info.nicknames || {})
  };

  const image = getImageURL(info);

  const backup = {
    name,
    originalThreadID: String(threadID),
    groupName: info.threadName || "",
    image,
    imageFile: null,
    members,
    nicknames,
    savedAt: new Date().toLocaleString("ar"),
    busy: false
  };

  let imageStatus = "غير متوفرة";

  if (image) {
    try {
      const buffer = await downloadImage(image);
      const destination = imageFile(name);

      fs.writeFileSync(destination, buffer);

      backup.imageFile = path.basename(destination);
      imageStatus = "تم حفظ الصورة محلياً";

    } catch (error) {
      imageStatus = "تعذر تنزيل الصورة: " + errorMessage(error);
      console.error("HINA SAVE IMAGE:", error);
    }
  }

  // حفظ JSON حتى لو فشل تنزيل الصورة
  saveBackup(name, backup);

  backups[name] = backup;

  return {
    members: members.length,
    nicknames: Object.keys(nicknames).length,
    groupName: backup.groupName,
    imageStatus,
    savedAt: backup.savedAt
  };
}

// =============================================
// تنفيذ الأمر
// =============================================

module.exports.run = async function({ api, event, args }) {

  const {
    threadID,
    messageID,
    senderID
  } = event;

  if (!isDeveloper(senderID)) {
    return send(
      api,
      "⛔ هذا الأمر مخصص لمطوري HINA فقط.",
      threadID,
      messageID
    );
  }

  global.client ||= {};
  global.client.handleReply ||= [];

  // ===========================================
  // حفظ نسخة
  // ===========================================

  if (args[0] === "حفظ") {

    const name = args.slice(1).join(" ").trim();

    if (!name) {
      return send(
        api,
        "الاستخدام:\nنقل حفظ [اسم النسخة]",
        threadID,
        messageID
      );
    }

    if (backups[name]?.busy) {
      return send(
        api,
        "⚠️ النسخة قيد الاستعادة حالياً.",
        threadID,
        messageID
      );
    }

    try {
      await send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `⏳ جارٍ حفظ المجموعة...\n` +
        `📂 النسخة: ${name}`,
        threadID,
        messageID
      );

    } catch (error) {
      console.error("HINA SAVE NOTICE:", error);
    }

    try {
      const result = await saveGroup(api, threadID, name);

      return send(
        api,
        `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
        `✅ تم حفظ النسخة!\n\n` +
        `📂 النسخة: ${name}\n` +
        `🏷️ اسم المجموعة: ${result.groupName || "غير معروف"}\n` +
        `👥 الأعضاء: ${result.members}\n` +
        `📝 الكنيات: ${result.nicknames}\n` +
        `🖼️ الصورة: ${result.imageStatus}\n` +
        `📅 التاريخ: ${result.savedAt}\n\n` +
        `💾 الحفظ: ملف محلي دائم`,
        threadID,
        messageID
      );

    } catch (error) {
      console.error("HINA SAVE ERROR:", error);

      return send(
        api,
        `❌ فشل حفظ النسخة.\n\nالسبب: ${errorMessage(error)}`,
        threadID,
        messageID
      );
    }
  }

  // ===========================================
  // عرض النسخ
  // ===========================================

  if (!args.length) {

    const names = Object.keys(backups);

    if (!names.length) {
      return send(
        api,
        "📂 لا توجد نسخ محفوظة.",
        threadID,
        messageID
      );
    }

    let message =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخ المحفوظة:\n\n`;

    names.forEach((name, index) => {

      const backup = backups[name];

      message +=
        `${index + 1}. ${name}\n` +
        `👥 الأعضاء: ${backup.members.length}\n` +
        `📝 الكنيات: ${Object.keys(backup.nicknames || {}).length}\n` +
        `📅 ${backup.savedAt}\n\n`;
    });

    message +=
      `━━━━━━━━━━━━━━━━\n` +
      `↩️ رد برقم النسخة لاستعادتها.`;

    try {
      const sent = await send(api, message, threadID);

      if (!sent?.messageID) {
        throw new Error("لم يتم الحصول على رقم الرسالة");
      }

      global.client.handleReply.push({
        name: module.exports.config.name,
        messageID: sent.messageID,
        author: String(senderID),
        type: "restore",
        backupNames: [...names]
      });

    } catch (error) {
      return send(
        api,
        `❌ تعذر عرض النسخ.\n${errorMessage(error)}`,
        threadID,
        messageID
      );
    }

    return;
  }

  return send(
    api,
    "الاستخدام:\nنقل حفظ [الاسم]\nنقل",
    threadID,
    messageID
  );
};

// =============================================
// استقبال الرد واختيار النسخة
// =============================================

module.exports.handleReply = async function({
  api,
  event,
  handleReply
}) {

  const {
    threadID,
    messageID,
    senderID,
    body
  } = event;

  if (!isDeveloper(senderID)) {
    return send(
      api,
      "⛔ هذا الأمر مخصص لمطوري HINA فقط.",
      threadID,
      messageID
    );
  }

  if (String(senderID) !== String(handleReply.author)) {
    return send(
      api,
      "⛔ هذه القائمة ليست خاصة بك.",
      threadID,
      messageID
    );
  }

  if (handleReply.type !== "restore") return;

  const choice = String(body || "").trim();

  if (!/^\d+$/.test(choice)) {
    return send(
      api,
      "⚠️ أرسل رقم النسخة فقط.",
      threadID,
      messageID
    );
  }

  const names = handleReply.backupNames || [];
  const index = Number(choice) - 1;

  if (index < 0 || index >= names.length) {
    return send(
      api,
      "❌ رقم النسخة غير صحيح.",
      threadID,
      messageID
    );
  }

  const name = names[index];
  const backup = backups[name];

  if (!backup) {
    return send(
      api,
      "❌ النسخة غير موجودة.",
      threadID,
      messageID
    );
  }

  if (backup.busy) {
    return send(
      api,
      "⏳ النسخة قيد الاستعادة.",
      threadID,
      messageID
    );
  }

  if (backup.originalThreadID === String(threadID)) {
    return send(
      api,
      "⚠️ لا يمكن الاستعادة داخل المجموعة الأصلية.",
      threadID,
      messageID
    );
  }

  // ===========================================
  // التحقق من المجموعة المستقبلة
  // ===========================================

  let targetInfo;

  try {
    targetInfo = await callApi(
      api,
      "getThreadInfo",
      [threadID]
    );

    const botID = getBotID(api);

    const adminIDs = (
      targetInfo?.adminIDs || []
    ).map(admin =>
      String(typeof admin === "object" ? admin.id : admin)
    );

    if (!adminIDs.includes(botID)) {
      return send(
        api,
        "❌ يجب أن يكون HINA مشرفاً في المجموعة المستقبلة.",
        threadID,
        messageID
      );
    }

  } catch (error) {
    return send(
      api,
      `❌ تعذر التحقق من المجموعة.\n${errorMessage(error)}`,
      threadID,
      messageID
    );
  }

  if (backup.busy) {
    return send(api, "⏳ النسخة قيد الاستعادة.", threadID, messageID);
  }

  // ===========================================
  // قفل النسخة
  // ===========================================

  backup.busy = true;

  const replyIndex = global.client.handleReply.findIndex(
    item =>
      item.messageID === handleReply.messageID &&
      item.name === module.exports.config.name
  );

  if (replyIndex !== -1) {
    global.client.handleReply.splice(replyIndex, 1);
  }

  const results = [];

  function addResult(label, success, attempts, details = "", error = null) {
    results.push({
      label,
      success,
      attempts,
      details,
      error
    });
  }

  async function execute(label, callback) {
    const result = await retry(callback);

    addResult(
      label,
      result.success,
      result.attempts,
      "",
      result.error || null
    );

    return result;
  }

  try {

    await send(
      api,
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `🚀 بدأت الاستعادة\n` +
      `📂 النسخة: ${name}\n` +
      `👥 الأعضاء: ${backup.members.length}\n` +
      `📝 الكنيات: ${Object.keys(backup.nicknames || {}).length}\n` +
      `🔄 المحاولات: ${MAX_RETRIES}`,
      threadID,
      messageID
    ).catch(console.error);

    // =========================================
    // 1 - اسم المجموعة
    // =========================================

    if (backup.groupName) {

      await execute("اسم المجموعة", async () => {
        await callApi(
          api,
          "setTitle",
          [backup.groupName, threadID]
        );
      });

    } else {
      addResult("اسم المجموعة", true, 0, "لا يوجد اسم محفوظ");
    }

    // =========================================
    // 2 - صورة المجموعة
    // =========================================

    const imageResult = await restoreImage(
      api,
      backup,
      name,
      threadID
    );

    addResult(
      "صورة المجموعة",
      imageResult.success,
      imageResult.attempts || 0,
      imageResult.details || "",
      imageResult.error || null
    );

    // =========================================
    // 3 - الأعضاء
    // =========================================

    let membership;

    try {
      membership = await refreshMembers(api, threadID);
    } catch (error) {
      membership = {
        members: new Set(),
        info: null
      };
    }

    let existing = membership.members;

    const botID = getBotID(api);

    let added = 0;
    let alreadyExists = 0;
    let ignored = 0;
    let failedMembers = [];

    for (const member of backup.members) {

      const id = String(member);

      if (id === botID) {
        ignored++;
        continue;
      }

      if (existing.has(id)) {
        alreadyExists++;
        continue;
      }

      const result = await retry(async () => {

        // تحديث القائمة قبل الإضافة
        const current = await refreshMembers(api, threadID);

        if (current.members.has(id)) {
          existing.add(id);
          return "already";
        }

        await callApi(
          api,
          "addUserToGroup",
          [id, threadID]
        );

        // لا نسجل النجاح قبل التحقق من العضوية
        await sleep(1500);

        const verification = await refreshMembers(api, threadID);

        if (!verification.members.has(id)) {
          throw new Error("لم يظهر العضو في قائمة أعضاء المجموعة بعد الإضافة");
        }

        existing.add(id);
        return "added";
      });

      if (!result.success) {

        failedMembers.push({
          id,
          error: result.error
        });

      } else if (result.result === "already") {

        alreadyExists++;

      } else {

        added++;
      }
    }

    // تحديث نهائي للأعضاء
    try {
      membership = await refreshMembers(api, threadID);
      existing = membership.members;
    } catch (error) {
      console.error("HINA MEMBER REFRESH:", error);
    }

    let memberDetails =
      `تمت الإضافة: ${added}\n` +
      `موجودون مسبقاً: ${alreadyExists}\n` +
      `تم تخطي حساب HINA: ${ignored}\n` +
      `فشل: ${failedMembers.length}`;

    if (failedMembers.length) {
      memberDetails += "\n\nتفاصيل الأعضاء:";
      for (const item of failedMembers.slice(0, 10)) {
        memberDetails +=
          `\n${item.id}: ${item.error}`;
      }
    }

    addResult(
      "الأعضاء",
      failedMembers.length === 0,
      MAX_RETRIES,
      memberDetails,
      failedMembers.length
        ? `فشلت إضافة ${failedMembers.length} عضواً`
        : null
    );

    // =========================================
    // 4 - الكنيات
    // =========================================

    let nicknameSuccess = 0;
    let nicknameFailed = [];
    let nicknameSkipped = 0;

    const nicknameEntries = Object.entries(
      backup.nicknames || {}
    );

    for (const [memberID, nickname] of nicknameEntries) {

      const id = String(memberID);

      if (
        nickname === null ||
        nickname === undefined ||
        nickname === ""
      ) {
        nicknameSkipped++;
        continue;
      }

      // تحديث العضوية قبل تغيير الكنية
      let currentMembers;

      try {
        currentMembers = await refreshMembers(api, threadID);
        existing = currentMembers.members;
      } catch (error) {
        nicknameFailed.push({
          id,
          error: "تعذر التحقق من عضوية الحساب: " + errorMessage(error)
        });
        continue;
      }

      if (!existing.has(id)) {
        nicknameFailed.push({
          id,
          error: "العضو غير موجود في المجموعة المستقبلة"
        });
        continue;
      }

      const result = await retry(async () => {
        await setNickname(api, nickname, threadID, id);
      });

      if (result.success) {
        nicknameSuccess++;
      } else {
        nicknameFailed.push({
          id,
          error: result.error
        });
      }
    }

    let nicknameDetails =
      `نجح: ${nicknameSuccess}\n` +
      `فشل: ${nicknameFailed.length}\n` +
      `لا توجد كنية محفوظة: ${nicknameSkipped}`;

    if (nicknameFailed.length) {
      nicknameDetails += "\n\nتفاصيل الكنيات:";
      for (const item of nicknameFailed.slice(0, 10)) {
        nicknameDetails += `\n${item.id}: ${item.error}`;
      }
    }

    addResult(
      "الكنيات",
      nicknameFailed.length === 0,
      MAX_RETRIES,
      nicknameDetails,
      nicknameFailed.length
        ? "تعذرت استعادة بعض الكنيات"
        : null
    );

    // =========================================
    // 5 - التقرير النهائي
    // =========================================

    const failed = results.filter(item => !item.success);
    const successful = results.filter(item => item.success);

    let report =
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `📂 النسخة: ${name}\n\n`;

    for (const result of results) {

      report +=
        `${result.success ? "✅" : "❌"} ${result.label}\n`;

      if (result.details) {
        report += result.details + "\n";
      } else {
        report += `المحاولات: ${result.attempts}/${MAX_RETRIES}\n`;
      }

      if (!result.success && result.error) {
        report += `⚠️ الخطأ: ${result.error}\n`;
      }

      report += "\n";
    }

    report +=
      `━━━━━━━━━━━━━━━━\n` +
      `✅ العمليات الناجحة: ${successful.length}\n` +
      `❌ العمليات الفاشلة: ${failed.length}\n`;

    if (failed.length === 0) {

      const deleted = deleteBackup(name);

      report +=
        `\n🎉 اكتملت الاستعادة.\n` +
        (
          deleted
            ? "🗑️ تم حذف ملفات النسخة المؤقتة."
            : "⚠️ تعذر حذف ملفات النسخة، يمكنك حذفها لاحقاً."
        );

    } else {

      report +=
        `\n⚠️ الاستعادة غير مكتملة.\n` +
        `💾 النسخة ما زالت محفوظة في الملفات.\n` +
        `يمكنك المحاولة مجدداً بكتابة: نقل`;
    }

    return await send(
      api,
      report,
      threadID,
      messageID
    );

  } catch (error) {

    console.error("HINA RECOVERY ERROR:", error);

    return send(
      api,
      `⌬ ━━ HINA RECOVERY ━━ ⌬\n\n` +
      `❌ حدث خطأ غير متوقع.\n\n` +
      `السبب: ${errorMessage(error)}\n\n` +
      `💾 النسخة ما زالت محفوظة في الملفات.`,
      threadID,
      messageID
    );

  } finally {

    if (backups[name]) {
      backups[name].busy = false;
    }
  }
};
