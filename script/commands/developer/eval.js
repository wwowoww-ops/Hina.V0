module.exports.config = {
    name: "eval",
    version: "1.1.0",
    hasPermssion: 2,
    credits: "𝐘-𝐀𝐍𝐁𝐔",
    description: "مش لك",
    commandCategory: "Developer",
    usePrefix: false,
    usages: "",
    cooldowns: 0
};

module.exports.run = async function({
    api,
    args,
    Users,
    event,
    Threads,
    Nero,
    utils,
    client
}) {

    try {

        /*
         * ==========================================
         * جلب IDs المطورين
         * ==========================================
         */

        const adminIDs = [];

        // ADMINBOT من config
        if (
            Array.isArray(
                global.config?.ADMINBOT
            )
        ) {

            adminIDs.push(
                ...global.config.ADMINBOT
            );
        }

        // KIRA_CONF.dev
        if (
            global.KIRA_CONF?.dev
        ) {

            if (
                Array.isArray(
                    global.KIRA_CONF.dev
                )
            ) {

                adminIDs.push(
                    ...global.KIRA_CONF.dev
                );

            } else {

                adminIDs.push(
                    global.KIRA_CONF.dev
                );
            }
        }


        /*
         * تحويل جميع IDs إلى String
         * وإزالة التكرار
         */

        const developers =
            [
                ...new Set(
                    adminIDs
                        .filter(Boolean)
                        .map(
                            id => String(id)
                        )
                )
            ];


        /*
         * ==========================================
         * التحقق من المطور
         * ==========================================
         */

        const senderID =
            String(
                event.senderID
            );


        if (
            !developers.includes(
                senderID
            )
        ) {

            return api.sendMessage(
                "هذا الأمر للمطور فقط.",
                event.threadID,
                event.messageID
            );
        }


        /*
         * ==========================================
         * إخراج النتيجة
         * ==========================================
         */

        function output(msg) {

            if (
                typeof msg === "number" ||
                typeof msg === "boolean" ||
                typeof msg === "function"
            ) {

                msg =
                    msg.toString();

            }

            else if (
                msg instanceof Map
            ) {

                let text =
                    `Map(${msg.size}) `;

                text +=
                    JSON.stringify(
                        mapToObj(msg),
                        null,
                        2
                    );

                msg = text;
            }

            else if (
                typeof msg === "object" &&
                msg !== null
            ) {

                try {

                    msg =
                        JSON.stringify(
                            msg,
                            null,
                            2
                        );

                } catch (error) {

                    msg =
                        String(msg);
                }
            }

            else if (
                typeof msg === "undefined"
            ) {

                msg =
                    "undefined";
            }


            api.sendMessage(
                String(msg),
                event.threadID,
                event.messageID
            );
        }


        /*
         * اختصار للإخراج
         */

        function out(msg) {
            output(msg);
        }


        /*
         * تحويل Map إلى Object
         */

        function mapToObj(map) {

            const obj = {};

            map.forEach(
                function(v, k) {

                    obj[k] = v;

                }
            );

            return obj;
        }


        /*
         * ==========================================
         * الكود الذي سيتم تنفيذه
         * ==========================================
         */

        const cmd = `
        (async () => {

            try {

                ${args.join(" ")}

            }

            catch(err) {

                console.log(
                    "eval command",
                    err
                );

                api.sendMessage(
                    err?.message ||
                    String(err),

                    event.threadID,
                    event.messageID
                );

            }

        })()
        `;


        /*
         * تنفيذ eval
         */

        eval(cmd);


    } catch (err) {

        console.log(
            "[EVAL ERROR]",
            err
        );

        return api.sendMessage(
            err?.message ||
            String(err),

            event.threadID,
            event.messageID
        );
    }
};