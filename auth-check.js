// auth-check.js - Lớp bảo vệ thứ hai (dự phòng)
(function() {
    const path = window.location.pathname;
    if (path === '/' || path.includes('login.html')) {
        document.body.style.display = '';
        return;
    }
    let user = null;
    try {
        const raw = localStorage.getItem('userDiamond');
        if (raw && raw !== 'undefined') user = JSON.parse(raw);
    } catch(e) {}
    if (!user || !user.role) {
        document.documentElement.innerHTML = '';
        window.location.replace('/');
    } else {
        document.body.style.display = '';
    }
})();