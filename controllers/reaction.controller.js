const prisma = require('../lib/prisma');

// --- HELPER SECURITY FUNCTIONS ---
// (Assuming these are defined elsewhere, e.g., utils/accessControl.js or imported from other controllers)

// Checks if a user is a member of a board
const checkBoardAccess = async (userId, boardId) => {
  if (!userId || !boardId) return false;
  const membership = await prisma.boardMembership.findUnique({
    where: { userId_boardId: { userId: userId, boardId: boardId } },
  });
  return !!membership; // Returns true if membership exists, false otherwise
};

// Checks if a user has access to a specific task (by checking board membership)
const checkTaskAccess = async (userId, taskId) => {
  if (!userId || !taskId) return false;
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { taskList: { select: { boardId: true } } },
  });
  if (!task) return false; // Task doesn't exist
  return await checkBoardAccess(userId, task.taskList.boardId);
};

// Helper Function: Gets the Board ID from a Comment ID for authorization checks
const getBoardIdFromComment = async (commentId) => {
    try {
        const comment = await prisma.taskComment.findUnique({
            where: { id: commentId },
            select: { task: { select: { taskList: { select: { boardId: true } } } } }
        });
        // Return the boardId if found, otherwise null
        return comment?.task?.taskList?.boardId ?? null;
    } catch (error) {
        // Handle cases where comment or related task/list might not be found
        console.error(`Error fetching boardId for comment ${commentId}:`, error);
        return null;
    }
};
// --- END HELPER FUNCTIONS ---


// 1. Add/Remove Reaction to a Task (Toggle)
exports.toggleTaskReaction = async (req, res) => {
    const { taskId } = req.params;
    const { emoji } = req.body; // Emoji to add/remove (e.g., "👍")
    const userId = req.user.id; // User performing the reaction (from authMiddleware)

    if (!emoji) {
        return res.status(400).json({ msg: 'Emoji is required.' });
    }
    // Optional: Basic emoji format validation
    // if (!/\p{Emoji}/u.test(emoji)) {
    //     return res.status(400).json({ msg: 'Invalid emoji format.' });
    // }

    try {
        // Security: Can the user access this task?
        const hasAccess = await checkTaskAccess(userId, taskId);
        if (!hasAccess) {
             // Check if the task exists before denying access based on permissions
             const taskExists = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
             if (!taskExists) {
                return res.status(404).json({ msg: 'Task not found.' });
             }
            return res.status(403).json({ msg: 'You do not have permission to react to this task.' });
        }

        // Find existing reaction using the unique constraint
        const existingReaction = await prisma.reaction.findUnique({
            where: {
                // Prisma's composite unique index name format for MongoDB
                userId_emoji_taskId: {
                    userId: userId,
                    emoji: emoji,
                    taskId: taskId,
                }
            }
        });

        let updatedReactions;
        let message;

        if (existingReaction) {
            // Reaction exists: Delete it
            await prisma.reaction.delete({
                where: { id: existingReaction.id }
            });
            message = 'Reaction removed.';

        } else {
            // Reaction doesn't exist: Create it
            await prisma.reaction.create({
                data: {
                    emoji: emoji,
                    userId: userId,
                    taskId: taskId, // Link to the task
                }
            });
            message = 'Reaction added.';
        }

        // Fetch the updated reaction counts for the task
        updatedReactions = await prisma.reaction.groupBy({
            by: ['emoji'],
            where: { taskId: taskId },
            _count: { emoji: true }, // Count occurrences of each emoji
            orderBy: { _count: { emoji: 'desc' } } // Order by most frequent
        });

        // Format the groupBy result for easier frontend consumption
        const formattedReactions = updatedReactions.map(r => ({
            emoji: r.emoji,
            count: r._count.emoji
        }));

        res.status(existingReaction ? 200 : 201).json({ message, reactions: formattedReactions });


    } catch (err) {
        console.error("toggleTaskReaction Error:", err.message);
        // P2002: Unique constraint violation (rare, could happen in race conditions)
        if (err.code === 'P2002') {
             return res.status(409).json({ msg: 'Conflict adding reaction, please try again.' });
        }
         // P2025: Related task not found (e.g., during create if task was deleted)
        if (err.code === 'P2025') {
            return res.status(404).json({ msg: 'Associated task not found.' });
        }
        res.status(500).send('Server Error');
    }
};

// 2. Add/Remove Reaction to a Comment (Toggle)
exports.toggleCommentReaction = async (req, res) => {
    const { commentId } = req.params;
    const { emoji } = req.body;
    const userId = req.user.id; // User performing the action

    if (!emoji) {
        return res.status(400).json({ msg: 'Emoji is required.' });
    }

    try {
        // Security: Can the user access the board this comment belongs to?
        const boardId = await getBoardIdFromComment(commentId);
        if (!boardId) {
             // getBoardIdFromComment returns null if the comment or its relations don't exist
             return res.status(404).json({ msg: 'Associated comment or board not found.' });
        }
        const hasAccess = await checkBoardAccess(userId, boardId);
        if (!hasAccess) {
            return res.status(403).json({ msg: 'You do not have permission to react to this comment.' });
        }

        // Find existing reaction
        const existingReaction = await prisma.reaction.findUnique({
            where: {
                 userId_emoji_commentId: { // Composite unique index name
                    userId: userId,
                    emoji: emoji,
                    commentId: commentId,
                }
            }
        });

        let updatedReactions;
        let message;

        if (existingReaction) {
            // Exists: Delete it
            await prisma.reaction.delete({
                where: { id: existingReaction.id }
            });
            message = 'Reaction removed.';
        } else {
            // Doesn't exist: Create it
            await prisma.reaction.create({
                data: {
                    emoji: emoji,
                    userId: userId,
                    commentId: commentId, // Link to the comment
                }
            });
            message = 'Reaction added.';
        }

        // Fetch updated reaction counts for the comment
        updatedReactions = await prisma.reaction.groupBy({
           by: ['emoji'],
           where: { commentId: commentId },
           _count: { emoji: true },
           orderBy: { _count: { emoji: 'desc' } }
        });

        // Format the groupBy result
        const formattedReactions = updatedReactions.map(r => ({
            emoji: r.emoji,
            count: r._count.emoji
        }));

        res.status(existingReaction ? 200 : 201).json({ message, reactions: formattedReactions });

    } catch (err) {
        console.error("toggleCommentReaction Error:", err.message);
        if (err.code === 'P2002') {
             return res.status(409).json({ msg: 'Conflict adding reaction, please try again.' });
        }
        // P2025: Related comment not found (e.g., during create/find)
        if (err.code === 'P2025') {
            return res.status(404).json({ msg: 'Associated comment not found.' });
        }
        res.status(500).send('Server Error');
    }
};