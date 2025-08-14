const UserLog = require("../models/UserLog");

const logUserAction = async ({
    user,
    action,
    targetType = null,
    targetId = null,
    device = null,
    location = {}
}) => {
    try {
        const logEntry = new UserLog({
            user,
            action,
            targetType,
            targetId,
            device,
            location
        });

        await logEntry.save();
    } catch (error) {
        console.error("Error logging user action:", error);
        // Avoid crashing the app — fail silently
    }
};

module.exports = logUserAction;