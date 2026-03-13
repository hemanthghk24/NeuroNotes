const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const db = require("./db");

const app = express();
// Default to 4001 to avoid clashing with an already-running server on 4000.
// You can still override it via: $env:PORT=4000; node server.js
const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

app.use(cors());
app.use(express.json());

// File upload storage (store files in backend/uploads)
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// ---------- Auth ----------

app.post("/api/auth/signup", (req, res) => {
  const { name, email, password, department, semester } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const sql = "INSERT INTO users (name, email, password, department, semester) VALUES (?, ?, ?, ?, ?)";
  const params = [name, email, password, department || "", semester || ""];
  db.run(sql, params, function (err) {
    if (err) {
      if (err.message && err.message.includes("UNIQUE")) {
        return res.status(409).json({ error: "Email already registered" });
      }
      return res.status(500).json({ error: "Failed to create user" });
    }
    res.json({
      id: this.lastID,
      name,
      email,
      department,
      semester
    });
  });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Missing email or password" });
  }

  db.get("SELECT * FROM users WHERE email = ? AND password = ?", [email, password], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Login failed" });
    }
    if (!row) {
      return res.status(401).json({ error: "Invalid email or password" });
    }
    res.json({
      id: row.id,
      name: row.name,
      email: row.email,
      department: row.department,
      semester: row.semester
    });
  });
});

// ---------- Resources ----------

// Create resource (with optional file upload)
app.post("/api/resources", upload.single("file"), (req, res) => {
  const { title, subject, type, link, ownerEmail, ownerName } = req.body;
  if (!title || !subject) {
    return res.status(400).json({ error: "Title and subject are required" });
  }
  const fileName = req.file ? req.file.filename : "";

  const sql = "INSERT INTO resources (title, subject, type, link, fileName, ownerEmail) VALUES (?, ?, ?, ?, ?, ?)";
  const params = [title, subject, type || "", link || "", fileName, ownerEmail || ""];
  db.run(sql, params, function (err) {
    if (err) {
      return res.status(500).json({ error: "Failed to save resource" });
    }
    res.json({
      id: this.lastID,
      title,
      subject,
      type,
      link,
      fileName,
      ownerEmail
    });
  });
});

// List resources, optionally filter by subject or owner
app.get("/api/resources", (req, res) => {
  const { subject, ownerEmail } = req.query;
  const params = [];
  const where = [];

  if (subject) {
    where.push("subject = ?");
    params.push(subject);
  }
  if (ownerEmail) {
    where.push("ownerEmail = ?");
    params.push(ownerEmail);
  }

  const sql =
    "SELECT * FROM resources" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY datetime(createdAt) DESC, id DESC";

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: "Failed to load resources" });
    }
    res.json(rows);
  });
});

// Serve uploaded files (view or download) - use regex so filename with dots (e.g. .pdf) is captured
app.get(/^\/api\/files\/(.+)$/, (req, res) => {
  const filename = path.basename(req.params[0]);
  if (!filename || filename.includes("..")) return res.status(400).json({ error: "Invalid filename" });
  const filePath = path.join(uploadDir, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });
  const download = req.query.download === "1" || req.query.download === "true";
  if (download) res.setHeader("Content-Disposition", "attachment; filename=\"" + filename + "\"");
  res.sendFile(path.resolve(filePath), (err) => {
    if (err) res.status(500).json({ error: "Could not send file" });
  });
});

// Delete a resource (and its file if present)
app.delete("/api/resources/:id", (req, res) => {
  const id = req.params.id;
  const requester = (req.query.ownerEmail || "").toString().trim();
  if (!id) {
    return res.status(400).json({ error: "Missing resource id" });
  }

  db.get("SELECT fileName, ownerEmail FROM resources WHERE id = ?", [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: "Failed to find resource" });
    }
    if (!row) {
      return res.status(404).json({ error: "Resource not found" });
    }
    if (!requester || (row.ownerEmail || "") !== requester) {
      return res.status(403).json({ error: "Not allowed to delete this resource" });
    }

    const filePath = row.fileName ? path.join(uploadDir, row.fileName) : null;

    db.run("DELETE FROM resources WHERE id = ?", [id], function (delErr) {
      if (delErr) {
        return res.status(500).json({ error: "Failed to delete resource" });
      }

      if (filePath) {
        fs.unlink(filePath, () => {
          // ignore fs errors
        });
      }

      res.json({ success: true });
    });
  });
});

app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
});

