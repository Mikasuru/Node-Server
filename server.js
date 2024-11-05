const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/uploads/messages', express.static(path.join(__dirname, 'uploads/messages')));

// Verify token middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  console.log('Auth header:', authHeader);
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      console.log('Token verification error:', err);
      return res.status(403).json({ error: 'Token ไม่ถูกต้อง' });
    }
    console.log('Verified user:', user);
    req.user = user;
    next();
  });
};

// Multer config for profile pictures
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads';
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile_picture-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const messageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = 'uploads/messages';
    if (!fs.existsSync(dir)){
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'message-image-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const uploadProfile = multer({ 
  storage: profileStorage,
  // ไม่จำกัดขนาดไฟล์
  limits: {
    fileSize: Infinity
  }
});

const uploadMessage = multer({ 
  storage: messageStorage,
  // ไม่จำกัดขนาดไฟล์
  limits: {
    fileSize: Infinity
  }
});

// Test endpoint
app.get('/status', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Register endpoint
app.post('/register', uploadProfile.single('profile_picture'), (req, res) => {
  console.log('Register request received:', req.body);
  console.log('File:', req.file);
  
  const { username, displayName, bio, password } = req.body;
  const profilePicture = req.file ? `/uploads/${req.file.filename}` : null;

  if (!username || !displayName || !password) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
  }

  db.get('SELECT id FROM users WHERE username = ?', [username], async (err, row) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการตรวจสอบผู้ใช้' });
    }

    if (row) {
      return res.status(400).json({ error: 'Username นี้ถูกใช้งานแล้ว' });
    }

    try {
      const saltRounds = 10;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      db.run(
        `INSERT INTO users (username, display_name, bio, profile_picture, password_hash)
         VALUES (?, ?, ?, ?, ?)`,
        [username, displayName, bio || '', profilePicture, passwordHash],
        function(err) {
          if (err) {
            console.error('Insert user error:', err);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการลงทะเบียน' });
          }

          db.get(
            `SELECT id, username, display_name, bio, profile_picture 
             FROM users WHERE id = ?`,
            [this.lastID],
            (err, user) => {
              if (err) {
                console.error('Get user error:', err);
                return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้' });
              }

              const token = jwt.sign(
                { userId: user.id },
                process.env.JWT_SECRET || 'your-secret-key',
                { expiresIn: '24h' }
              );

              res.status(201).json({
                message: 'ลงทะเบียนสำเร็จ',
                token,
                user: {
                  id: user.id,
                  username: user.username,
                  displayName: user.display_name,
                  bio: user.bio,
                  profilePicture: user.profile_picture
                }
              });
            }
          );
        }
      );
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({ 
        error: 'เกิดข้อผิดพลาดในการลงทะเบียน',
        details: error.message 
      });
    }
  });
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  console.log('Login attempt for:', username);

  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user) {
      console.log('User not found');
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('Invalid password');
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }

    const token = jwt.sign(
      { userId: user.id },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '24h' }
    );

    console.log('Login successful for user:', user.id);
    console.log('Generated token:', token);

    res.json({
      message: 'เข้าสู่ระบบสำเร็จ',
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        profilePicture: user.profile_picture
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' });
  }
});

// Get users endpoint
app.get('/users', authenticateToken, (req, res) => {
  console.log('Getting users for userId:', req.user.userId);
  
  db.all(
    `SELECT id, username, display_name as displayName, bio, profile_picture as profilePicture
     FROM users WHERE id != ?`,
    [req.user.userId],
    (err, users) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูลผู้ใช้' });
      }
      console.log('Found users:', users);
      res.json(users);
    }
  );
});

// Get messages endpoint
app.get('/messages/:userId', authenticateToken, (req, res) => {
  const { userId } = req.params;
  
  console.log('Getting messages for users:', req.user.userId, 'and', userId);
  
  db.all(
    `SELECT messages.*, 
            sender.username as sender_username, 
            sender.display_name as sender_display_name,
            receiver.username as receiver_username,
            receiver.display_name as receiver_display_name
     FROM messages 
     JOIN users sender ON messages.sender_id = sender.id
     JOIN users receiver ON messages.receiver_id = receiver.id
     WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
     ORDER BY messages.created_at DESC`,
    [req.user.userId, userId, userId, req.user.userId],
    (err, messages) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อความ' });
      }
      console.log('Found messages:', messages);
      res.json(messages);
    }
  );
});

// Send message endpoint
app.post('/messages', authenticateToken, (req, res) => {
  const { receiverId, content } = req.body;
  
  if (!content || !receiverId) {
    return res.status(400).json({ error: 'กรุณาระบุผู้รับและเนื้อหาข้อความ' });
  }

  console.log('Sending message:', {
    senderId: req.user.userId,
    receiverId,
    content
  });
  
  db.run(
    `INSERT INTO messages (sender_id, receiver_id, content, type, created_at)
     VALUES (?, ?, ?, 'text', datetime('now'))`,
    [req.user.userId, receiverId, content],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งข้อความ' });
      }

      // ดึงข้อความที่เพิ่งส่งเพื่อส่งกลับ
      db.get(
        `SELECT messages.*, 
                sender.username as sender_username, 
                sender.display_name as sender_display_name,
                receiver.username as receiver_username,
                receiver.display_name as receiver_display_name
         FROM messages 
         JOIN users sender ON messages.sender_id = sender.id
         JOIN users receiver ON messages.receiver_id = receiver.id
         WHERE messages.id = ?`,
        [this.lastID],
        (err, message) => {
          if (err) {
            console.error('Error getting sent message:', err);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งข้อความ' });
          }
          
          console.log('Message sent:', message);
          res.status(201).json(message);
        }
      );
    }
  );
});

// Send image message endpoint
app.post('/messages/image', authenticateToken, uploadMessage.single('image'), (req, res) => {
  const { receiverId } = req.body;
  const imagePath = req.file ? `/uploads/messages/${req.file.filename}` : null;

  if (!imagePath || !receiverId) {
    return res.status(400).json({ error: 'กรุณาระบุผู้รับและรูปภาพ' });
  }

  console.log('Sending image message:', {
    senderId: req.user.userId,
    receiverId,
    imagePath
  });

  db.run(
    `INSERT INTO messages (sender_id, receiver_id, image_url, type, created_at)
     VALUES (?, ?, ?, 'image', datetime('now'))`,
    [req.user.userId, receiverId, imagePath],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งรูปภาพ' });
      }

      // ดึงข้อความที่เพิ่งส่งเพื่อส่งกลับ
      db.get(
        `SELECT messages.*, 
                sender.username as sender_username, 
                sender.display_name as sender_display_name,
                receiver.username as receiver_username,
                receiver.display_name as receiver_display_name
         FROM messages 
         JOIN users sender ON messages.sender_id = sender.id
         JOIN users receiver ON messages.receiver_id = receiver.id
         WHERE messages.id = ?`,
        [this.lastID],
        (err, message) => {
          if (err) {
            console.error('Error getting sent message:', err);
            return res.status(500).json({ error: 'เกิดข้อผิดพลาดในการส่งรูปภาพ' });
          }
          
          console.log('Image message sent:', message);
          res.status(201).json(message);
        }
      );
    }
  );
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'เกิดข้อผิดพลาด',
    message: err.message
  });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});