// includes/fcaSafe.js  (v2)
// طبقة حماية فوق api الخاص بمكتبة FCA:
//  - sendMessage: يقبل كل الصيغ (messageID كمعامل ثالث)، يعيد المحاولة، ويتعلم تلقائياً لو "الرد على رسالة" لا تعمل
//  - getThreadInfo: يعيد المحاولة، ثم آخر نتيجة سليمة، ثم معلومات بديلة بدل ما يوقف البوت
//  - setMessageReaction: لا يرمي أخطاء أبداً
//  - حفظ الـ appstate دورياً

const fs = require("fs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFn = (f) => typeof f === "function";
const errMsg = (e) => {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  try {
    return e.message || e.error || e.errorSummary || e.details || JSON.stringify(e);
  } catch (x) {
    return String(e);
  }
};

function callCb(cb, err, val) {
  if (!isFn(cb)) return;
  try {
    cb(err, val);
  } catch (e) {
    console.error("❌ [ FCA SAFE ] خطأ داخل callback:", e && e.stack ? e.stack : e);
  }
}

function fallbackInfo(id) {
  return {
    threadID: String(id),
    threadName: "",
    name: "",
    participantIDs: [],
    userInfo: [],
    unreadCount: 0,
    messageCount: 0,
    timestamp: String(Date.now()),
    muteUntil: null,
    isGroup: String(id).length > 15,
    isSubscribed: true,
    folder: "INBOX",
    isArchived: false,
    cannotReplyReason: null,
    emoji: null,
    color: null,
    nicknames: {},
    adminIDs: [],
    approvalMode: false,
    approvalQueue: [],
    snippet: "",
    snippetAttachments: [],
    imageSrc: null,
    __fallback: true
  };
}

function normalizeMsg(msg) {
  if (msg == null) return { body: "" };
  if (typeof msg === "string" || typeof msg === "number") return { body: String(msg) };
  const m = Object.assign({}, msg);
  if (m.body != null && typeof m.body !== "string") m.body = String(m.body);
  if (m.attachment != null && !Array.isArray(m.attachment)) m.attachment = [m.attachment];
  if (Array.isArray(m.attachment)) {
    m.attachment = m.attachment.filter(Boolean);
    if (!m.attachment.length) delete m.attachment;
  }
  const hasContent =
    (m.body && m.body.length) || m.attachment || m.sticker || m.url || m.location || m.emoji;
  if (!hasContent) m.body = "";
  return m;
}

module.exports = function fcaSafe(api, opts = {}) {
  if (!api || api.__fcaSafe) return api;
  api.__fcaSafe = true;

  const cfg = Object.assign(
    {
      sendTimeoutMs: 90000,
      minGapMs: 700,
      infoRetries: 1,
      replyDisableAfter: 3, // بعد كم فشل متتالي للرد-على-رسالة نوقفه تلقائياً
      // true  = لو فشل getThreadInfo نرجع معلومات بديلة فاضية (البوت يكمل)
      // false = نرجع الخطأ للكود الأصلي (مناسب لبوت يعالج null بنفسه، ويمنع تخزين معلومات فاضية في الكاش/الداتابيز)
      threadInfoFallback: true,
      log: true,
      appStateFile: null,
      saveEveryMs: 20 * 60 * 1000
    },
    opts
  );
  const log = (...a) => cfg.log && console.log("[ FCA SAFE ]", ...a);

  // محادثات المكتبة ما تقدر تجيب معلوماتها (غالباً مشفّرة E2EE أو غير متاحة)
  const badThreads = new Set();

  // ───────────── getThreadInfo ─────────────
  const origGTI = api.getThreadInfo;
  if (isFn(origGTI)) {
    const lastGood = new Map();

    const callOnce = (ids) =>
      new Promise((resolve, reject) => {
        let done = false;
        const finish = (e, v) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          e ? reject(e) : resolve(v);
        };
        const t = setTimeout(() => finish(new Error("getThreadInfo timeout")), 20000);
        try {
          const r = origGTI.call(api, ids, (e, v) => finish(e, v));
          if (r && isFn(r.then)) {
            r.then(
              (v) => {
                if (v !== undefined) finish(null, v);
              },
              (e) => finish(e)
            );
          }
        } catch (e) {
          finish(e);
        }
      });

    api.getThreadInfo = function (threadID, callback) {
      const run = async () => {
        let lastErr;
        for (let i = 0; i <= cfg.infoRetries; i++) {
          try {
            const info = await callOnce(threadID);
            if (info && typeof info === "object") {
              if (!Array.isArray(threadID)) {
                lastGood.set(String(threadID), info);
                badThreads.delete(String(threadID));
              }
              return info;
            }
            lastErr = new Error("empty thread info");
          } catch (e) {
            lastErr = e;
            if (/no message_thread data/i.test(errMsg(e))) {
              if (!Array.isArray(threadID)) badThreads.add(String(threadID));
              break; // خطأ ثابت، لا فائدة من الإعادة
            }
          }
          if (i < cfg.infoRetries) await sleep(1200);
        }
        if (!Array.isArray(threadID)) {
          const cached = lastGood.get(String(threadID));
          if (cached) {
            log(`getThreadInfo فشل لـ ${threadID} → استخدام آخر نتيجة سليمة`);
            return cached;
          }
          if (cfg.threadInfoFallback) {
            log(`getThreadInfo فشل لـ ${threadID} → معلومات بديلة (${errMsg(lastErr)})`);
            return fallbackInfo(threadID);
          }
          log(`getThreadInfo فشل لـ ${threadID} → إرجاع الخطأ (${errMsg(lastErr)})`);
        }
        throw lastErr;
      };
      const p = run();
      p.catch(() => {});
      if (isFn(callback)) {
        p.then(
          (v) => callCb(callback, null, v),
          (e) => callCb(callback, e)
        );
        return;
      }
      return p;
    };
  }

  // ───────────── sendMessage ─────────────
  const origSend = api.sendMessage;
  // بعض المكتبات توفر إرسال عبر MQTT (بدل HTTP) — نستخدمه كخطة بديلة لو الـ HTTP يرجع 500/فشل
  const origMqtt = isFn(api.sendMessageMqtt) ? api.sendMessageMqtt : null;
  if (isFn(origSend)) {
    const queues = new Map();
    let replyFails = 0;
    let replyDisabled = false;

    const enqueue = (key, fn) => {
      const prev = queues.get(key) || Promise.resolve();
      const next = prev
        .catch(() => {})
        .then(fn)
        .then(
          async (v) => {
            await sleep(cfg.minGapMs);
            return v;
          },
          async (e) => {
            await sleep(cfg.minGapMs);
            throw e;
          }
        );
      queues.set(key, next);
      next
        .catch(() => {})
        .then(() => {
          if (queues.get(key) === next) queues.delete(key);
        });
      return next;
    };

    const sendOnce = (m, tid, reply, single, via) =>
      new Promise((resolve, reject) => {
        let done = false;
        const finish = (e, v) => {
          if (done) return;
          done = true;
          clearTimeout(t);
          e ? reject(e) : resolve(v);
        };
        const t = setTimeout(() => finish(new Error("send timeout")), cfg.sendTimeoutMs);
        try {
          const fn = via === "mqtt" && origMqtt ? origMqtt : origSend;
          const r = fn.call(api, m, tid, (e, v) => finish(e, v), reply, single);
          if (r && isFn(r.then)) {
            r.then(
              (v) => {
                if (v !== undefined) finish(null, v);
              },
              (e) => finish(e)
            );
          }
        } catch (e) {
          finish(e);
        }
      });

    api.sendMessage = function (msg, threadID, a3, a4, a5) {
      const callback = [a3, a4].find(isFn);
      const replyRaw = [a3, a4].find((x) => typeof x === "string" || typeof x === "number");
      const replyTo = replyRaw !== undefined && replyRaw !== "" ? String(replyRaw) : undefined;
      const single = a5;
      const tid = Array.isArray(threadID) ? threadID : String(threadID);

      const base = normalizeMsg(msg);

      // مسارات الملفات لإعادة إنشاء الـ streams عند إعادة المحاولة
      const attPaths = (base.attachment || []).map((a) =>
        a && typeof a.path === "string" ? a.path : null
      );
      const rebuildAttachments = () =>
        (base.attachment || []).map((a, i) => {
          if (attPaths[i] && fs.existsSync(attPaths[i])) {
            try {
              if (a && isFn(a.destroy)) a.destroy();
            } catch (e) {}
            return fs.createReadStream(attPaths[i]);
          }
          return a;
        });

      const emptyMsg =
        !base.attachment && !base.sticker && !base.url && !base.location && !base.emoji && !base.body;
      if (emptyMsg) {
        callCb(callback, null, {});
        return Promise.resolve({});
      }

      const hasAtt = !!base.attachment;
      const useReply = replyTo !== undefined && !replyDisabled;

      const plans = [];
      if (useReply) plans.push({ name: "عادي", reply: replyTo, wait: 0 });
      plans.push({ name: useReply ? "بدون رد" : "عادي", reply: undefined, wait: useReply ? 1500 : 0 });
      if (origMqtt) plans.push({ name: "MQTT", reply: undefined, via: "mqtt", wait: 1000 });
      plans.push({ name: "إعادة", reply: undefined, wait: 3500 });
      if (hasAtt) plans.push({ name: "نص فقط", reply: undefined, wait: 2000, textOnly: true });

      const textOnlyMsg = () => {
        const m = Object.assign({}, base);
        delete m.attachment;
        m.body = (m.body ? m.body + "\n" : "") + "⚠️ | تعذّر إرفاق الملف.";
        return m;
      };

      const run = () =>
        enqueue(Array.isArray(tid) ? tid.join(",") : tid, async () => {
          let lastErr;
          let replyAttemptFailed = false;
          for (let i = 0; i < plans.length; i++) {
            const p = plans[i];
            if (p.wait) await sleep(p.wait);
            const m = p.textOnly
              ? textOnlyMsg()
              : i === 0 || !hasAtt
              ? base
              : Object.assign({}, base, { attachment: rebuildAttachments() });
            try {
              const res = await sendOnce(m, tid, p.reply, single, p.via);
              if (p.via === "mqtt") log(`تم الإرسال إلى ${tid} عبر MQTT (الـ HTTP فاشل)`);
              // تعلّم: هل "الرد على رسالة" هو سبب الفشل؟
              if (p.reply !== undefined) {
                replyFails = 0;
              } else if (replyAttemptFailed && !replyDisabled && p.name === "بدون رد") {
                replyFails++;
                if (replyFails >= cfg.replyDisableAfter) {
                  replyDisabled = true;
                  log("الرد-على-رسالة يفشل باستمرار مع هذي المكتبة → تم تعطيله تلقائياً (الإرسال صار بدون رد)");
                }
              }
              return res;
            } catch (e) {
              lastErr = e;
              if (p.reply !== undefined) replyAttemptFailed = true;
              log(`فشل الإرسال إلى ${tid} (خطة: ${p.name}) → ${errMsg(e)}`);
            }
          }
          const hint = badThreads.has(String(tid))
            ? "\n   ↳ هذي المحادثة ترجع GraphQL فاضي (غالباً مشفّرة E2EE أو غير متاحة للمكتبة). جرّب البوت في قروب."
            : "";
          console.error(`❌ [ FCA SAFE ] فشل الإرسال نهائياً إلى ${tid}: ${errMsg(lastErr)}${hint}`);
          throw lastErr || new Error("Send message failed");
        });

      const p = run();
      p.catch(() => {});
      if (isFn(callback)) {
        p.then(
          (v) => callCb(callback, null, v),
          (e) => callCb(callback, e)
        );
      }
      return p;
    };
  }

  // ───────────── setMessageReaction ─────────────
  const origReact = api.setMessageReaction;
  if (isFn(origReact)) {
    api.setMessageReaction = function (reaction, messageID, cb, force) {
      let called = false;
      const done = (e) => {
        if (called) return;
        called = true;
        callCb(cb, e || null);
      };
      try {
        const r = origReact.call(api, reaction, messageID, (e) => done(e), force);
        if (r && isFn(r.then)) r.then(() => done(null), (e) => done(e));
      } catch (e) {
        done(e);
      }
    };
  }

  // ───────────── حفظ الـ appstate دورياً ─────────────
  if (cfg.appStateFile && isFn(api.getAppState)) {
    const timer = setInterval(() => {
      try {
        fs.writeFileSync(cfg.appStateFile, JSON.stringify(api.getAppState(), null, "\t"));
      } catch (e) {
        console.error("[ FCA SAFE ] تعذر حفظ appstate:", e.message);
      }
    }, cfg.saveEveryMs);
    if (timer.unref) timer.unref();
  }

  log(`تم تفعيل طبقة الحماية (v4) | sendMessageMqtt متاحة: ${isFn(api.sendMessageMqtt) ? "نعم" : "لا"}`);
  return api;
};