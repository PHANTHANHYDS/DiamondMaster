require('dotenv').config();
console.log("ENV:", process.env.MONGODB_URI);
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer'); 
const cron = require('node-cron'); 
const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- 1. KẾT NỐI DATABASE ---
const mongoURI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/quan_ly_truong_hoc'; 
mongoose.connect(mongoURI)
    .then(() => console.log("✅ HỆ THỐNG ĐÃ KẾT NỐI DATABASE BẢO MẬT!"))
    .catch(err => console.error("❌ Lỗi kết nối:", err));

// --- 2. CẤU TRÚC SCHEMAS ---
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

// --- API THỐNG KÊ (DASHBOARD) ---
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

// --- HÀM GHI NHẬT KÝ TÁC NGHIỆP ---
async function saveActionLog(req, action, detail) {
    try {
        const { username, fullName, role } = req.body.userAuth || {};
        if (role === 'Admin' || username === 'admin' || !username) return; 
        await new ActionLog({ userName: `${fullName} (${username})`, action, detail }).save();
    } catch (e) { console.error("Lỗi log:", e); }
}

// --- 3. LOGIC TỰ ĐỘNG CHỐT SỔ (CRON JOB NGÀY 10) ---
cron.schedule('0 0 10 * *', async () => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() + 1}-${now.getFullYear()}`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ originalId: t._id, thangChot: label, dataBackup: t.toObject() }).save();
            await TruongHoc.findByIdAndUpdate(t._id, { 
                trangThaiThi: "", noiDungKeHoach: "", ngayKeHoach: "", 
                ghiChuThi: "", lichSuNhatKy: [] 
            });
        }
        console.log("📦 Đã tự động chốt sổ tháng mới!");
    } catch (e) { console.error("Lỗi Cron:", e); }
});

// --- 4. API HỆ THỐNG QUẢN LÝ TRƯỜNG ---
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
    if (user) res.json({ success: true, user: { id: user._id, fullName: user.fullName, role: user.role, username: user.username } });
    else res.json({ success: false, message: "Sai tài khoản!" });
});

// --- 5. API ADMIN (NHÂN SỰ, ARCHIVE, TRASH) ---
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

// API CHỐT TAY QUAN TRỌNG
app.post('/api/admin/force-archive', async (req, res) => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() + 1}-${now.getFullYear()} (Chốt tay)`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ 
                originalId: t._id, 
                thangChot: label, 
                dataBackup: t.toObject() 
            }).save();
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

// --- PHỤC VỤ FILE TĨNH ---
app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/eduscheduler', (req, res) => res.sendFile(path.join(__dirname, 'eduscheduler.html')));

app.listen(PORT, "0.0.0.0", () => 
  console.log(`🚀 DIAMOND MASTER READY AT PORT ${PORT}!`)
);