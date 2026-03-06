// auth-check.js
(function() {
    const user = localStorage.getItem('userDiamond');
    // Nếu không có thông tin đăng nhập trong máy
    if (!user) {
        // Đuổi ngay về trang login
        window.location.href = 'login.html'; 
    }
})();