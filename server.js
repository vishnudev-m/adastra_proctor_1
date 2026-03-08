const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
// ================= ADMIN AUTH =================

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "rover123";

let adminToken = null;

const app = express();

app.use(cors());
app.use(express.json());

// ------------------ MongoDB Connection ------------------

mongoose.connect(process.env.MONGO_URI)
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("MongoDB Error:", err));

// ------------------ Models ------------------

const Candidate = require("./models/Candidate");
const Question = require("./models/Question");
const AllowedCandidate = require("./models/AllowedCandidate");

// ------------------ Test Route ------------------

app.get("/", (req, res) => {
    res.json({ message: "Proctoring Server Running" });
});

// =======================================================
// 🚀 START EXAM
// =======================================================

app.post("/start-exam", async (req, res) => {
    try {
        const { name, registerNumber, password } = req.body;

        if (!name || !registerNumber || !password) {
            return res.status(400).json({ message: "All fields are required." });
        }

        const allowed = await AllowedCandidate.findOne({
            name,
            registerNumber,
            password
        });

        if (!allowed) {
            return res.status(403).json({ message: "Invalid credentials." });
        }

        if (allowed.hasAttempted) {
            return res.status(403).json({ message: "You have already attempted the exam." });
        }

        const candidate = new Candidate({
            name,
            registerNumber,
            startTime: new Date(),
            fullscreenExits: 0,
            tabSwitches: 0,
            isSubmitted: false
        });

        await candidate.save();

        allowed.hasAttempted = true;
        await allowed.save();

        res.json({
            message: "Exam started successfully",
            candidateId: candidate._id
        });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Server error. Please try again." });
    }
});

// =======================================================
// 📚 GET QUESTIONS
// =======================================================

app.get("/get-questions", async (req, res) => {
    try {

        const questions = await Question.aggregate([
            { $sample: { size: 20 } }
        ]);

        const safeQuestions = questions.map(q => ({
            _id: q._id,
            questionText: q.questionText,
            options: q.options
        }));

        res.json(safeQuestions);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error fetching questions." });
    }
});

// =======================================================
// 📝 SUBMIT EXAM (DETAILED ANSWERS STORED)
// =======================================================

app.post("/submit-exam", async (req, res) => {
    try {
        const { candidateId, answers } = req.body;

        if (!candidateId || !answers) {
            return res.status(400).json({ message: "Invalid submission data." });
        }

        const candidate = await Candidate.findById(candidateId);

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found." });
        }

        if (candidate.isSubmitted) {
            return res.status(403).json({ message: "Exam already submitted." });
        }

        const examDuration = 20 * 60 * 1000;
        const currentTime = new Date();
        const timeElapsed = currentTime - candidate.startTime;

        if (timeElapsed > examDuration) {
            candidate.endTime = currentTime;
            candidate.isSubmitted = true;
            await candidate.save();

            return res.status(403).json({ message: "Time expired. Exam auto-closed." });
        }

        let score = 0;
        let detailedAnswers = [];

        for (let ans of answers) {

            const question = await Question.findById(ans.questionId);

            if (question) {

                const isCorrect = question.correctAnswer === ans.selectedOption;

                if (isCorrect) score++;

                detailedAnswers.push({
                    questionId: question._id,
                    selectedOption: ans.selectedOption,
                    correctOption: question.correctAnswer,
                    isCorrect: isCorrect
                });
            }
        }

        candidate.score = score;
        candidate.answers = detailedAnswers;
        candidate.endTime = currentTime;
        candidate.isSubmitted = true;

        await candidate.save();

        res.json({ message: "Exam submitted successfully." });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Submission failed. Try again." });
    }
});

// =======================================================
// 🖥 FULLSCREEN VIOLATION
// =======================================================

app.post("/fullscreen-violation", async (req, res) => {
    try {
        const { candidateId } = req.body;

        if (!candidateId) {
            return res.status(400).json({ message: "Invalid request." });
        }

        const candidate = await Candidate.findById(candidateId);

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found." });
        }

        candidate.fullscreenExits += 1;
        await candidate.save();

        res.json({ message: "Violation recorded." });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Could not record violation." });
    }
});

// =======================================================
// 📵 TAB SWITCH VIOLATION
// =======================================================

app.post("/tab-violation", async (req, res) => {
    try {
        const { candidateId } = req.body;

        if (!candidateId) {
            return res.status(400).json({ message: "Invalid request." });
        }

        const candidate = await Candidate.findById(candidateId);

        if (!candidate) {
            return res.status(404).json({ message: "Candidate not found." });
        }

        candidate.tabSwitches += 1;
        await candidate.save();

        res.json({ message: "Tab switch recorded." });

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error recording tab violation." });
    }
});

// =======================================================
// 🧑‍💼 ADMIN RESULTS PANEL
// =======================================================

app.get("/admin/results", async (req, res) => {
    try {

        const token = req.headers["x-admin-token"];

        if (!token || token !== adminToken) {
            return res.status(403).json({
                message: "Unauthorized access"
            });
        }

        const results = await Candidate.find({ isSubmitted: true })
            .select("-__v");

        res.json(results);

    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "Error fetching results." });
    }
});


//admin login
app.post("/admin/login", (req, res) => {

    const { username, password } = req.body;

    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {

        adminToken = Math.random().toString(36).substring(2);

        return res.json({
            message: "Login successful",
            token: adminToken
        });
    }

    return res.status(401).json({
        message: "Invalid admin credentials"
    });
});

// ------------------ Start Server ------------------

app.listen(5000, () => {
    console.log("Server running on port 5000");
});
