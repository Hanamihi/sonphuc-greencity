const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwHK0oo4SHviMpKj9yZ_tOnA61JwSMjh1x3Ds_yhsUxYYZEchzXAdzNwQtEqSYdwU5aig/exec"; 
let dataBDS = {}; 
const infoBox = document.getElementById('info-box');

// Tải ĐỒNG THỜI file SVG và dữ liệu từ Google Sheets
Promise.all([
    fetch('assets/svg/map.svg').then(response => response.text()),
    fetch(SCRIPT_URL).then(response => response.json())
])
.then(([svgContent, data]) => {
    // 1. Nhúng đoạn mã SVG vào trang HTML
    document.getElementById('map-wrapper').innerHTML = svgContent;
    
    // 2. Lưu dữ liệu Google Sheet
    dataBDS = data; 
    console.log("Đã tải dữ liệu và bản đồ thành công!");
    
    // 3. Khởi tạo chức năng (Vẽ tên lô, Click, Zoom)
    initMap();      
    initZoom();     
})
.catch(error => {
    console.error("Lỗi khởi tạo:", error);
    alert("Không thể tải dữ liệu hoặc bản đồ. Vui lòng kiểm tra lại đường dẫn!");
});

// Hàm xử lý bản đồ
function initMap() {
    document.querySelectorAll('svg g[id]').forEach(lot => {
        const id = lot.id;
        
        // KIỂM TRA: Nếu mã lô có dữ liệu trong file Excel
        if (dataBDS[id]) {
            const info = dataBDS[id];
            
            // Gắn class tương tác để CSS nhận diện (thay thế cho việc gọi tên LK, BT)
            lot.classList.add('lot-interactive');

            // --- TẠO NHÃN TÊN VÀ ĐỔI MÀU (ĐÃ BÁN) ---
            const shape = lot.querySelector('rect, polygon, path'); 
            if (shape) {
                // Đổi màu xám nếu trạng thái là Đã bán
                if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                    shape.style.fill = "#7f8c8d"; 
                    shape.style.opacity = "0.8";  
                }

                // Xử lý xoay text chữ (Giữ nguyên logic tính textAngle của bạn)
                let textAngle = 0;
                if (shape.tagName.toLowerCase() === 'rect') {
                    let baseAngle = 0;
                    const w = parseFloat(shape.getAttribute('width'));
                    const h = parseFloat(shape.getAttribute('height'));
                    if (h > w) baseAngle = -90; 
                    const transform = shape.getAttribute('transform');
                    if (transform && transform.includes('rotate')) {
                        const match = transform.match(/rotate\(([-0-9.]+)/);
                        if (match) baseAngle += parseFloat(match[1]);
                    }
                    textAngle = baseAngle;
                } else if (shape.tagName.toLowerCase() === 'polygon') {
                    const pointsStr = shape.getAttribute('points').trim().split(/[\s,]+/);
                    const points = [];
                    for (let i = 0; i < pointsStr.length; i += 2) {
                        if (pointsStr[i] !== undefined && pointsStr[i+1] !== undefined) {
                            points.push({x: parseFloat(pointsStr[i]), y: parseFloat(pointsStr[i+1])});
                        }
                    }
                    if (points.length >= 3) {
                        let maxDist = 0;
                        for (let i = 0; i < points.length; i++) {
                            let p1 = points[i];
                            let p2 = points[(i + 1) % points.length];
                            let dx = p2.x - p1.x;
                            let dy = p2.y - p1.y;
                            let dist = dx*dx + dy*dy; 
                            if (dist > maxDist) {
                                maxDist = dist;
                                textAngle = Math.atan2(dy, dx) * (180 / Math.PI);
                            }
                        }
                    }
                }

                while (textAngle > 90) textAngle -= 180;
                while (textAngle <= -90) textAngle += 180;

                const bbox = lot.getBBox();
                const centerX = bbox.x + bbox.width / 2;
                const centerY = bbox.y + bbox.height / 2;

                const textLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
                textLabel.setAttribute("x", centerX);
                textLabel.setAttribute("y", centerY);
                textLabel.setAttribute("text-anchor", "middle");
                textLabel.setAttribute("dominant-baseline", "middle");
                textLabel.setAttribute("class", "lot-label");
                textLabel.setAttribute("transform", `rotate(${textAngle} ${centerX} ${centerY})`);
                textLabel.textContent = id; 
                lot.appendChild(textLabel);
            }

            // --- SỰ KIỆN CLICK MỞ POPUP ---
            lot.addEventListener('click', function(e) {
                document.getElementById('malo').innerText = "Lô: " + id;
                
                // Đổ dữ liệu Trạng thái & Màu sắc
                const statusEl = document.getElementById('trangThai');
                statusEl.innerText = info.TrangThai; // Map với cột TrangThai
                if (info.TrangThai === "Đang bán") {
                    statusEl.style.color = "#27ae60"; 
                } else if (info.TrangThai === "Đã bán" || info.TrangThai === "Đã Bán") {
                    statusEl.style.color = "#e74c3c"; 
                } else {
                    statusEl.style.color = "#f39c12"; // Đang cập nhật
                }

                // Đổ dữ liệu chung
                document.getElementById('loai').innerText = info.Loai;
                document.getElementById('dientich').innerText = info.DienTichLo;
                
                const constructInfo = document.getElementById('construction-info');
                
                // LOGIC THÔNG MINH: Nếu là "Đất nền", ẩn thông tin xây dựng
                if (info.Loai.toLowerCase() === "đất nền") {
                    constructInfo.style.display = "none";
                } else {
                    constructInfo.style.display = "block";
                    // Map dữ liệu theo đúng tên cột Excel
                    document.getElementById('sotang').innerText = info.ChieuCao;
                    document.getElementById('dtxd').innerText = info.DienTichXD;
                    document.getElementById('matdo').innerText = info.MatDo;
                    document.getElementById('t1').innerText = info.Tang1;
                    document.getElementById('t2').innerText = info.Tang2;
                    document.getElementById('t3').innerText = info.Tang3;
                    document.getElementById('t4').innerText = info.Tang4;
                    document.getElementById('tongSan').innerText = info.TongSanXD;
                }

                infoBox.style.display = "block";
                if (window.innerWidth <= 768) {
                    infoBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
                e.stopPropagation(); 
            });
        }
    });
}

// Đóng popup khi click ra ngoài
document.addEventListener('click', function() { infoBox.style.display = "none"; });
infoBox.addEventListener('click', function(e) { e.stopPropagation(); });

// Hàm khởi tạo Zoom (Giữ nguyên logic của bạn)
function initZoom() {
        var eventsHandler = {
            haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
            init: function(options) {
                var instance = options.instance, initialScale = 1, pannedX = 0, pannedY = 0;
                this.hammer = new Hammer(options.svgElement, { 
                    recognizers: [ [Hammer.Pan, {direction: Hammer.DIRECTION_ALL}], [Hammer.Pinch, {enable: true}] ] 
                });
                this.hammer.on('panstart panmove', function(ev){
                    if (ev.type === 'panstart') { pannedX = 0; pannedY = 0; }
                    instance.panBy({x: ev.deltaX - pannedX, y: ev.deltaY - pannedY});
                    pannedX = ev.deltaX; pannedY = ev.deltaY;
                });
                this.hammer.on('pinchstart pinchmove', function(ev){
                    if (ev.type === 'pinchstart') { initialScale = instance.getZoom(); }
                    instance.zoomAtPoint(initialScale * ev.scale, {x: ev.center.x, y: ev.center.y});
                });
            },
            destroy: function(){ this.hammer.destroy(); }
        };

        svgPanZoom('#map-svg', {
            zoomEnabled: true,
            controlIconsEnabled: true, 
            fit: true,                 
            center: true,              
            minZoom: 0.5,
            maxZoom: 10,
            mouseWheelZoomEnabled: true, 
            preventMouseEventsDefault: false, 
            customEventsHandler: eventsHandler 
        });
    }
