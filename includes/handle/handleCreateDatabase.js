
module.exports = function ({
    Users,
    Threads,
    Currencies
}) {

    const logger = require("../../utils/log.js");

    // ==================================================
    // DATABASE TIMEOUT
    // ==================================================

    function withTimeout(task, ms = 8000) {
        let timer;

        return Promise.race([
            Promise.resolve().then(task),

            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error("DATABASE_TIMEOUT"));
                }, ms);
            })
        ]).finally(() => {
            clearTimeout(timer);
        });
    }

    return async function ({ event }) {

        try {

            if (!event || !global.data) return;

            const {
                allUserID,
                allCurrenciesID,
                allThreadID,
                userName,
                threadInfo,
                threadData
            } = global.data;

            if (global.config.autoCreateDB === false) return;

            const senderID = String(event.senderID || "");
            const threadID = String(event.threadID || "");

            if (!senderID) return;

            // ==================================================
            // GROUP
            // ==================================================

            if (
                threadID &&
                event.isGroup === true &&
                !allThreadID.includes(threadID)
            ) {

                let threadInfoFromFB;

                try {

                    threadInfoFromFB = await withTimeout(
                        () => Threads.getInfo(threadID),
                        8000
                    );

                } catch (error) {

                    console.error(
                        "[THREAD INFO TIMEOUT/ERROR]",
                        error.message
                    );

                    return;
                }

                if (
                    !threadInfoFromFB ||
                    typeof threadInfoFromFB !== "object"
                ) {
                    return;
                }

                const dataThread = {
                    threadName: threadInfoFromFB.threadName || "",
                    adminIDs: threadInfoFromFB.adminIDs || [],
                    nicknames: threadInfoFromFB.nicknames || {}
                };

                allThreadID.push(threadID);

                if (threadInfo && typeof threadInfo.set === "function") {
                    threadInfo.set(threadID, dataThread);
                }

                if (threadData && typeof threadData.set === "function") {
                    threadData.set(threadID, {});
                }

                // ==================================================
                // CREATE GROUP
                // ==================================================

                try {

                    const existing = await withTimeout(
                        () => Threads.getData(threadID),
                        8000
                    );

                    if (!existing || existing === false) {

                        await withTimeout(
                            () => Threads.createData(
                                threadID,
                                {
                                    threadInfo: dataThread,
                                    data: {}
                                }
                            ),
                            8000
                        );
                    }

                } catch (error) {

                    console.error(
                        "[THREAD CREATE ERROR]",
                        error.message
                    );
                }

                // ==================================================
                // USERS OF GROUP
                // ==================================================

                if (Array.isArray(threadInfoFromFB.userInfo)) {

                    for (const singleData of threadInfoFromFB.userInfo) {

                        if (!singleData) continue;

                        const uid = String(singleData.id || "");

                        if (!uid) continue;

                        const name = singleData.name || "";

                        if (userName && typeof userName.set === "function") {
                            userName.set(uid, name);
                        }

                        if (!allUserID.includes(uid)) {

                            try {

                                await withTimeout(
                                    () => Users.createData(
                                        uid,
                                        {
                                            name,
                                            data: {}
                                        }
                                    ),
                                    8000
                                );

                            } catch (error) {

                                try {

                                    await withTimeout(
                                        () => Users.setData(
                                            uid,
                                            { name }
                                        ),
                                        8000
                                    );

                                } catch (e) {

                                    console.error(
                                        "[GROUP USER SAVE ERROR]",
                                        uid,
                                        e.message
                                    );
                                }
                            }

                            allUserID.push(uid);

                            logger(
                                `New user: ${name} || ${uid}`,
                                "[ USER ]"
                            );
                        }
                    }
                }

                logger(
                    `New group: ${threadID} || ${dataThread.threadName}`,
                    "[ THREAD ]"
                );
            }

            // ==================================================
            // CURRENT USER
            // ==================================================

            if (
                senderID &&
                (
                    !allUserID.includes(senderID) ||
                    !userName.has(senderID)
                )
            ) {

                try {

                    const infoUser = await withTimeout(
                        () => Users.getInfo(senderID),
                        8000
                    );

                    const name = infoUser?.name || "";

                    if (!allUserID.includes(senderID)) {

                        try {

                            await withTimeout(
                                () => Users.createData(
                                    senderID,
                                    {
                                        name,
                                        data: {}
                                    }
                                ),
                                8000
                            );

                        } catch (error) {

                            try {

                                await withTimeout(
                                    () => Users.setData(
                                        senderID,
                                        { name }
                                    ),
                                    8000
                                );

                            } catch (e) {}
                        }

                        allUserID.push(senderID);

                    } else {

                        try {

                            await withTimeout(
                                () => Users.setData(
                                    senderID,
                                    { name }
                                ),
                                8000
                            );

                        } catch (e) {}
                    }

                    if (userName && typeof userName.set === "function") {
                        userName.set(senderID, name);
                    }

                    logger(
                        `New user: ${name} || ${senderID}`,
                        "[ USER ]"
                    );

                } catch (error) {

                    console.error(
                        "[CURRENT USER DATABASE ERROR]",
                        error.message
                    );
                }
            }

            // ==================================================
            // CURRENCY
            // ==================================================

            if (
                senderID &&
                !allCurrenciesID.includes(senderID)
            ) {

                try {

                    await withTimeout(
                        () => Currencies.createData(
                            senderID,
                            {
                                data: {}
                            }
                        ),
                        8000
                    );

                } catch (error) {

                    console.error(
                        "[CURRENCY CREATE ERROR]",
                        error.message
                    );
                }

                if (!allCurrenciesID.includes(senderID)) {
                    allCurrenciesID.push(senderID);
                }
            }

        } catch (error) {

            console.error(
                "[HANDLE CREATE DATABASE ERROR]",
                error
            );
        }
    };
};
