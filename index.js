require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cron = require('node-cron');
const app = express();

const PORT = process.env.PORT || 3000;

// Cấu hình session
app.use(session({
    secret: 'diamond_master_secret_2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Middleware chặn truy cập file tĩnh khi chưa đăng nhập
app.use((req, res, next) => {
    const pathUrl = req.path;
    // Các route công khai (không cần đăng nhập)
    const publicRoutes = ['/', '/login.html', '/eduscheduler', '/eduscheduler.html'];
    if (publicRoutes.includes(pathUrl)) {
        return next();
    }
    // API login/logout công khai
    if (pathUrl === '/api/login' || pathUrl === '/api/logout') {
        return next();
    }
    // Kiểm tra session
    if (req.session && req.session.user) {
        return next();
    }
    // Chưa đăng nhập -> chuyển về trang login
    res.redirect('/');
});

// Kết nối MongoDB
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quan_ly_truong_hoc';
mongoose.connect(mongoURI)
    .then(() => console.log("✅ Kết nối DB thành công"))
    .catch(err => console.error("❌ Lỗi DB:", err));

// --- Schema (giữ nguyên như cũ) ---
const ArchiveTruongHoc = mongoose.model('ArchiveTruongHoc', new mongoose.Schema({
    originalId: String, thangChot: String, dataBackup: Object, timestamp: { type: Date, default: Date.now }
}));
const ActionLog = mongoose.model('ActionLog', new mongoose.Schema({ 
    userName: String, action: String, detail: String, timestamp: { type: Date, default: Date.now } 
}));
const TruongHoc = mongoose.model('TruongHoc', new mongoose.Schema({ 
    tenTruong: String, khuVuc: String, capHoc: String, diaChi: String, hieuTruong: String, sdtHieuTruong: String,
    quanLy: String, nhanSu: String, hocVuTA: String, donViGV: String, diemDanh: String, hang: String,
    trangThaiThi: String, moTa: String, noiDungKeHoach: String, ngayKeHoach: String, ghiChuThi: String,
    noiDungKeHoach2: String, ngayKeHoach2: String, gvGiangDay: String, gvOnThi: String, monDaoTao: String,
    siSoChiTiet: [{ khoi: String, soLop: String, soHocSinh: String, monThi: [String] }],
    lichSuNhatKy: Array, isDeleted: { type: Boolean, default: false },
    config: { dsGioTiet: [String], ngayHoatDong: [Number], soTietToiDa: Number } 
}));
const GiaoVien = mongoose.model('GiaoVien', new mongoose.Schema({ hoTen: String, monDay: String, email: String, luongTH: Number, luongTHCS: Number, luongTHPT: Number, phuCap: Number, lichBan: [String] }));
const LichDay = mongoose.model('LichDay', new mongoose.Schema({ truongId: String, giaoVienId: String, ngayDay: String, tietThu: Number, lopHoc: String, ghiChu: String }));
const User = mongoose.model('User', new mongoose.Schema({ username: { type: String, unique: true }, password: { type: String }, fullName: String, role: String }));

// --- API ---
app.get("/api/thong-ke", async (req, res) => {
    try {
        const truongCount = await TruongHoc.countDocuments({ isDeleted: false });
        const tatCaTruong = await TruongHoc.find({ isDeleted: false });
        let tongHocSinh = 0, tongLop = 0;
        tatCaTruong.forEach(t => {
            if (t.siSoChiTiet) {
                t.siSoChiTiet.forEach(item => {
                    tongHocSinh += (Number(item.soHocSinh) || 0);
                    tongLop += (Number(item.soLop) || 0);
                });
            }
        });
        res.json({ truong: truongCount, hocSinh: tongHocSinh, lop: tongLop, daThi: 0 });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

async function saveActionLog(req, action, detail) {
    try {
        const { username, fullName, role } = req.body.userAuth || {};
        if (role === 'Admin' || username === 'admin' || !username) return; 
        await new ActionLog({ userName: `${fullName} (${username})`, action, detail }).save();
    } catch (e) { console.error("Lỗi log:", e); }
}

cron.schedule('0 0 10 * *', async () => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() + 1}-${now.getFullYear()}`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ originalId: t._id, thangChot: label, dataBackup: t.toObject() }).save();
            await TruongHoc.findByIdAndUpdate(t._id, { trangThaiThi: "", noiDungKeHoach: "", ngayKeHoach: "", ghiChuThi: "", lichSuNhatKy: [] });
        }
        console.log("📦 Đã tự động chốt sổ tháng mới!");
    } catch (e) { console.error("Lỗi Cron:", e); }
});

app.get('/api/danh-sach-truong', async (req, res) => {
    try { res.json(await TruongHoc.find({ isDeleted: false })); } catch (e) { res.status(500).send(e.message); }
});
app.get('/api/lay-truong/:id', async (req, res) => {
    try { res.json(await TruongHoc.findById(req.params.id)); } catch (e) { res.status(404).send("Lỗi"); }
});
app.put('/api/sua-truong/:id', async (req, res) => {
    if (req.body.maBaoMat !== '888') return res.status(403).send("Sai mã!");
    try { 
        const truongOld = await TruongHoc.findById(req.params.id);
        await TruongHoc.findByIdAndUpdate(req.params.id, req.body); 
        await saveActionLog(req, "SỬA TRƯỜNG", `Cập nhật: ${truongOld.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});
app.post('/api/them-truong', async (req, res) => {
    if (req.body.maBaoMat !== '888') return res.status(403).send("Sai mã!");
    try { 
        const moi = new TruongHoc(req.body); await moi.save(); 
        await saveActionLog(req, "THÊM MỚI", `Tạo mới: ${req.body.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});
app.delete('/api/xoa-truong/:id', async (req, res) => {
    if (req.body.maBaoMat !== '888') return res.status(403).send("Sai mã!");
    try { 
        const truong = await TruongHoc.findById(req.params.id);
        await TruongHoc.findByIdAndUpdate(req.params.id, { isDeleted: true }); 
        await saveActionLog(req, "XÓA TRƯỜNG", `Xóa: ${truong.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) {
        req.session.user = { id: user._id, fullName: user.fullName, role: user.role, username: user.username };
        res.json({ success: true, user: req.session.user });
    } else {
        res.json({ success: false, message: "Sai tài khoản!" });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) return res.status(500).send("Lỗi logout");
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/admin/list-users', async (req, res) => {
    try { res.json(await User.find({}, '-password')); } catch (e) { res.status(500).send(e.message); }
});
app.get('/api/admin/archive-months', async (req, res) => {
    try { 
        const months = await ArchiveTruongHoc.distinct("thangChot"); 
        res.json(months.reverse()); 
    } catch (e) { res.status(500).send(e.message); }
});
app.get('/api/admin/archive-data/:month', async (req, res) => {
    try { res.json(await ArchiveTruongHoc.find({ thangChot: req.params.month })); } catch (e) { res.status(500).send(e.message); }
});
app.post('/api/admin/force-archive', async (req, res) => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() + 1}-${now.getFullYear()} (Chốt tay)`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ originalId: t._id, thangChot: label, dataBackup: t.toObject() }).save();
        }
        res.send("OK"); 
    } catch (e) { res.status(500).send(e.message); }
});
app.get('/api/admin/trash', async (req, res) => {
    try { res.json(await TruongHoc.find({ isDeleted: true })); } catch (e) { res.status(500).send(e.message); }
});
app.post('/api/admin/restore/:id', async (req, res) => {
    try { 
        await TruongHoc.findByIdAndUpdate(req.params.id, { isDeleted: false }); 
        res.send("OK"); 
    } catch (e) { res.status(500).send(e.message); }
});
app.get('/api/admin/action-logs', async (req, res) => {
    try { res.json(await ActionLog.find().sort({ timestamp: -1 }).limit(100)); } catch (e) { res.status(500).send(e.message); }
});

// Phục vụ file tĩnh (sau khi đã qua middleware)
app.use(express.static(__dirname));

// Route mặc định
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/eduscheduler', (req, res) => res.sendFile(path.join(__dirname, 'eduscheduler.html')));

app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));