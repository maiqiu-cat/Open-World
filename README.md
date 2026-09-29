# Open World — 实时 3D 海洋模拟器

这是一个纯浏览器的 WebGL2 实时海洋场景。项目没有任何第三方依赖和构建步骤，也不加载外部资源。

## 运行

直接用 Chrome、Edge 或 Safari 17+ 打开 `index.html` 即可，`file://` 也能运行。

也可以起一个本地服务器：

```bash
cd "Open World" && python3 -m http.server 8000   # 然后访问 http://localhost:8000
```

需要支持 WebGL2 和 `EXT_color_buffer_float`，近几年的桌面浏览器都满足。

## 功能

与视频里的控制面板一一对应。

| 面板 | 内容 |
|---|---|
| **Camera** | 巡游：10 个电影镜头自动巡游，镜头间淡入淡出（海平线 / 帆船 / 船舷 / 贴浪 / 潜水 ×2 / 航拍 / 海鸥 / 云天 / 海岸）。自由飞行。下一镜头 |
| **Sea** | 6 个海况预设：Glassy、Calm、Breeze、Fresh、Rough、Storm<br>可调：风速、涌浪、方向、陡度、浪高、白沫 |
| **Sky** | 7 个时段：日出到夜晚<br>太阳高度、太阳方位<br>6 种天气：Clear、Fair、Cloudy、Overcast、Rain、Storm<br>云量、云速 |
| **Water** | 4 种水色：Open ocean、Tropical、Coastal green、Arctic<br>3 种水深：Deep ocean、Lagoon、Shallows<br>夜光（生物荧光）、清澈度 |
| **Image & Sound** | 程序化声音开关、画质 Low / Medium / High、曝光、辉光、视野 |

左上角显示 `镜头 · 海况 · 天气 · 太阳高度`。右上角显示 fps 和渲染分辨率，Close 按钮可以收起面板。

**Free fly 操作**
- 鼠标拖动：转视角
- `WASD`：移动
- `E` / `Space`：上升；`Q` / `C`：下降
- `Shift`：加速
- 滚轮：调速
- `H`：显示或隐藏面板
- 在 Tour 模式下按 `N` 切到下一个镜头

## 技术实现

| 模块 | 文件 | 要点 |
|---|---|---|
| 海浪 | `js/ocean.js` | **波浪谱**：CPU 生成 JONSWAP 谱，叠加方向扩散和独立涌浪<br>**FFT**：GPU 上的 Stockham FFT，3 级联（521 m / 84 m / 14 m）<br>**白沫**：用 Jacobian 检测波峰碎浪，并随时间衰减<br>**网格**：极坐标 LOD，带地球曲率<br>**水面着色**：GGX 高光、菲涅尔、次表面散射、浅水海底折射与焦散、帆船尾迹（Kelvin 波）、Voronoi 蕾丝状白沫和泡沫下的曝气水体、岛屿浅滩与岸边碎浪、雨滴涟漪<br>**水下看水面**：Snell 窗与全反射 |
| 天空 | `js/sky.js` | **大气**：Rayleigh + Mie + 臭氧散射 LUT<br>**云噪声**：GPU 生成 128³ 可平铺的 Perlin-Worley 噪声<br>**体积云**：光线步进，含 Beer-Powder、双瓣相位函数、多重散射近似；按距离选 mip，并做时域累积 (TAA)<br>**反射**：半球八面体天空穹顶，供水面反射<br>**其他**：太阳、月亮、星空、闪电 |
| 物体 | `js/objects.js` | **帆船**：程序化建模，在 GPU 上采样 FFT 位移算浮力、俯仰和横摇；帆布有分片缝线、压条、加强补片和船级徽标，逆光时能透出来；有支索、侧支索、撑臂、护栏线、绞盘；船漆带清漆反射，柚木甲板有板缝<br>**鱼**：反荫蔽色、侧线、斑纹、眼睛、银色反光加虹彩<br>**海鸥**：实例化渲染，带扑翼动画<br>**鱼群**：650 条，诱饵球式环游，尾部摆动<br>**岛屿地形**、浅水沙底、雨线、水下悬浮颗粒 |
| 后期 | `js/post.js` | **渲染目标**：4× MSAA HDR<br>**水下光柱**：体积光线步进<br>**Bloom**：CoD 式降采样 / 升采样链<br>**色调映射**：AgX<br>**镜头效果**：雨滴、暗角、胶片颗粒 |
| 镜头 | `js/camera.js` | 巡游镜头都以太阳、帆船、鱼群、海鸥为参照编排。低空镜头会读回水面高度，避免穿浪 |
| 声音 | `js/audio.js` | Web Audio 实时合成：海浪、浪花嘶声、风、雨、水下闷声、海鸥叫声、雷声 |
| 其他 | `js/core.js` `js/glsl.js` `js/ui.js` `js/main.js` | GL 工具、共享着色器库、控制面板与预设、主循环 |

深度缓冲使用对数深度，所以从 5 cm 到 200 km 范围内都不会出现 z-fighting。水面高度通过 PBO 加 fence 异步回读，不会阻塞 GPU。

## 性能

以下数据在 Apple M4 上测得，画质为 High：
- 1280×800：60 fps
- 2560×1600：约 50 fps

低端设备可以选 Medium 或 Low 画质，会同时降低 FFT 分辨率、网格密度、云步数、渲染分辨率和 MSAA。

## 调试参数

可以通过 URL 参数直接进入某个状态，例如：

```
index.html?shot=3&shotT=8&hold=1&time=noon&weather=storm&sea=rough&water=tropical&depth=lagoon&quality=medium&panel=0
```

- `shot` / `shotT`：指定巡游镜头和镜头内的时间
- `hold`：冻结镜头
- `panel=0`：隐藏面板
- 所有预设名和滑杆字段（如 `wind=15`、`sunHeight=20`）都可以直接覆盖

## 与原视频的差异

这是根据视频从零编写的实现，不是原作源码，所以画面不会逐帧一致。控制面板的布局和取值，以及主要视觉元素，都按视频做了对应：
- 金色时刻与积云
- 帆船、海鸥、远处岛屿
- 水下鱼群、Snell 窗和船底剪影
- 暴风雨中的雨线与镜头水滴
- 黄昏和夜晚

云的具体形状、调色细节、船的模型精度，与原视频仍有差别。
