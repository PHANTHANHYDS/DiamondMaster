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

// --- LỚP BẢO VỆ 1: NGĂN TRUY CẬP TRỰC TIẾP FILE HTML ---
// Người lạ gõ link/quan-ly.html sẽ bị đá văng về trang login
// app.get('/:page.html', (req, res, next) => {
//     const privatePages = ['quan-ly', 'them-moi', 'thong-ke', 'sua', 'eduscheduler'];
//     if (privatePages.includes(req.params.page)) {
//         return res.redirect('/'); 
//     }
//     next();
// });

app.use(express.static(__dirname));

// --- LỚP BẢO VỆ 2: GIẤU LINK DATABASE ---
// ĐÃ SỬA: Chỉ lấy từ Render Environment, không để lộ link thật ở đây nữa
const mongoURI = process.env.MONGODB_URI; 

if (!mongoURI) {
    console.error("❌ LỖI: Chưa cấu hình MONGODB_URI trên Render!");
}

mongoose.connect(mongoURI)
    .then(() => console.log("✅ HỆ THỐNG ĐÃ KẾT NỐI DATABASE BẢO MẬT!"))
    .catch(err => console.error("❌ Lỗi kết nối:", err));

// --- 1. CẤU TRÚC SCHEMAS (GIỮ NGUYÊN) ---
const ArchiveTruongHoc = mongoose.model('ArchiveTruongHoc', new mongoose.Schema({
    originalId: String,
    thangChot: String, 
    dataBackup: Object,
    timestamp: { type: Date, default: Date.now }
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
    lichSuNhatKy: Array, 
    isDeleted: { type: Boolean, default: false },
    config: { dsGioTiet: [String], ngayHoatDong: [Number], soTietToiDa: Number } 
}));

const GiaoVien = mongoose.model('GiaoVien', new mongoose.Schema({ hoTen: String, monDay: String, email: String, luongTH: Number, luongTHCS: Number, luongTHPT: Number, phuCap: Number, lichBan: [String] }));
const LichDay = mongoose.model('LichDay', new mongoose.Schema({ truongId: String, giaoVienId: String, ngayDay: String, tietThu: Number, lopHoc: String, ghiChu: String }));
const User = mongoose.model('User', new mongoose.Schema({ username: { type: String, unique: true }, password: { type: String }, fullName: String, role: String }));

// --- HÀM HỖ TRỢ: GHI NHẬT KÝ TÁC NGHIỆP (Audit Log - GIỮ NGUYÊN) ---
async function saveActionLog(req, action, detail) {
    try {
        const { username, fullName, role } = req.body.userAuth || {};
        if (role === 'Admin' || username === 'admin') return;
        if (!username) return; 

        await new ActionLog({
            userName: `${fullName} (${username})`,
            action: action,
            detail: detail,
            timestamp: new Date()
        }).save();
    } catch (e) { console.error("Lỗi ghi log tác nghiệp:", e); }
}

// --- 2. LOGIC TỰ ĐỘNG CHỐT SỔ (Ngày 10 hàng tháng - GIỮ NGUYÊN) ---
cron.schedule('0 0 10 * *', async () => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() === 0 ? 12 : now.getMonth()}-${now.getFullYear()}`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ originalId: t._id, thangChot: label, dataBackup: t.toObject() }).save();
            await TruongHoc.findByIdAndUpdate(t._id, {
                trangThaiThi: "", noiDungKeHoach: "", ngayKeHoach: "", ghiChuThi: "",
                noiDungKeHoach2: "", ngayKeHoach2: "", lichSuNhatKy: [] 
            });
        }
        console.log("📦 Đã tự động chốt sổ và reset tháng mới!");
    } catch (e) { console.error("Lỗi Cron:", e); }
});

// --- 3. API HỆ THỐNG GỐC (GIỮ NGUYÊN) ---
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
        await saveActionLog(req, "SỬA TRƯỜNG", `Cập nhật thông tin trường: ${truongOld.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/them-truong', async (req, res) => {
    if (req.body.maBaoMat !== '888') return res.status(403).send("Sai mã!");
    try { 
        const moi = new TruongHoc(req.body); 
        await moi.save(); 
        await saveActionLog(req, "THÊM MỚI", `Tạo mới trường: ${req.body.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/api/xoa-truong/:id', async (req, res) => {
    if (req.body.maBaoMat !== '888') return res.status(403).send("Sai mã!");
    try { 
        const truong = await TruongHoc.findById(req.params.id);
        await TruongHoc.findByIdAndUpdate(req.params.id, { isDeleted: true }); 
        await saveActionLog(req, "XÓA TRƯỜNG", `Đưa trường vào thùng rác: ${truong.tenTruong}`);
        res.send("OK"); 
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = await User.findOne({ username, password });
    if (user) res.json({ success: true, user: { id: user._id, fullName: user.fullName, role: user.role, username: user.username } });
    else res.json({ success: false, message: "Sai tài khoản!" });
});

// --- 4. API CHO ADMIN (GIỮ NGUYÊN) ---
app.get('/api/admin/list-users', async (req, res) => {
    try { res.json(await User.find({}, '-password')); } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/admin/create-user', async (req, res) => {
    try {
        const { username, password, fullName, role } = req.body;
        if (role === 'Admin' || username.toLowerCase() === 'admin') {
            return res.status(403).send("Không thể tạo tài khoản cấp bậc Admin tối cao!");
        }
        const check = await User.findOne({ username });
        if (check) return res.status(400).send("Tên đăng nhập đã tồn tại!");
        await new User({ username: username.toLowerCase(), password, fullName, role }).save();
        res.send("OK");
    } catch (e) { res.status(500).send(e.message); }
} );

app.delete('/api/admin/delete-user/:id', async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        if (!userToDelete) return res.status(404).send("Không thấy nhân sự!");
        if (userToDelete.role === 'Admin' || userToDelete.username === 'admin') {
            return res.status(403).send("Không thể chạm tới tài khoản Admin tối cao!");
        }
        await User.findByIdAndDelete(req.params.id);
        res.send("Đã xoá nhân sự!");
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/admin/archive-months', async (req, res) => {
    try { const months = await ArchiveTruongHoc.distinct("thangChot"); res.json(months.sort().reverse()); } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/admin/archive-data/:month', async (req, res) => {
    try { 
        const data = await ArchiveTruongHoc.find({ thangChot: req.params.month });
        res.json(data.map(item => {
            const d = item.dataBackup;
            const tongSiSo = (d.siSoChiTiet || []).reduce((sum, lop) => sum + (parseInt(lop.soHocSinh) || 0), 0);
            return { ...d, tongSiSo, ngayChot: item.timestamp };
        })); 
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/admin/trash', async (req, res) => {
    try { res.json(await TruongHoc.find({ isDeleted: true })); } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/admin/restore/:id', async (req, res) => {
    try { 
        await TruongHoc.findByIdAndUpdate(req.params.id, { isDeleted: false }); 
        const truong = await TruongHoc.findById(req.params.id);
        await saveActionLog(req, "KHÔI PHỤC", `Khôi phục trường từ thùng rác: ${truong.tenTruong}`);
        res.send("OK"); 
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/admin/action-logs', async (req, res) => {
    try { res.json(await ActionLog.find().sort({ timestamp: -1 }).limit(100)); } catch (e) { res.status(500).send(e.message); }
});

app.post('/api/admin/force-archive', async (req, res) => {
    try {
        const danhSach = await TruongHoc.find({ isDeleted: false });
        const now = new Date();
        const label = `${now.getMonth() + 1}-${now.getFullYear()} (Chốt tay)`;
        for (let t of danhSach) {
            await new ArchiveTruongHoc({ originalId: t._id, thangChot: label, dataBackup: t.toObject() }).save();
        }
        await saveActionLog(req, "ARCHIVE", `Chốt danh sách thủ công: ${label}`);
        res.send("Đã lưu bản sao vào kho Archive thành công!");
    } catch (e) { res.status(500).send(e.message); }
});

// --- CÁC TIỆN ÍCH KHÁC (GIỮ NGUYÊN) ---
app.get('/api/logs', async (req, res) => res.json(await ActionLog.find().sort({ timestamp: -1 }).limit(50)));
app.get('/api/giao-vien', async (req, res) => res.json(await GiaoVien.find()));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/eduscheduler', (req, res) => res.sendFile(path.join(__dirname, 'eduscheduler.html')));

app.listen(PORT, () => console.log(`🚀 DIAMOND MASTER V127 READY AT PORT ${PORT}!`));