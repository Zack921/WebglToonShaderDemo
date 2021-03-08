// 卡通渲染只是非真实感渲染中一个很小的子集
let vertexShaderToon = `
        uniform vec3 color;
        uniform vec3 light; // 光源位置
        varying vec3 vColor;
        varying vec3 vPosition;
        varying vec2 vUv;
        varying vec3 viewLight;
        varying vec3 viewPosition;
        varying vec3 viewNormal;
        void main()
        {
            // 直接传递给fs
            vColor = color;
            vPosition = position;
            vUv = uv;
        
            // 转换成视图坐标系（摄像机位置即坐标原点）下的光源坐标/顶点坐标/法线坐标，传递给fs
            // viewLight = normalize( (modelViewMatrix * vec4(light, 1.0)).xyz );
            viewLight = normalize(vec4(light, 1.0).xyz); // 单位化光源方向
            viewPosition = ( modelViewMatrix * vec4(position, 1.0)).xyz;
            // 法向量表示的是一个方向，而光源位置表示的是一个坐标。如果用法向量乘以  modelViewMatrix 得到的结果就可能不再垂直于面片
            viewNormal = normalize(normalMatrix * normal); // normalMatrix 是modelViewMatrix的逆转置矩阵
        
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        
        }
    `
let fragShaderToon = `
        varying vec3 vColor;
        varying vec3 vPosition;
        varying vec2 vUv;
        varying vec3 viewLight;
        varying vec3 viewPosition;
        varying vec3 viewNormal;
        uniform sampler2D _MainTex;
        uniform sampler2D _skinMap;
        uniform int hasSkinMap;
        uniform int isHighlight; // 高光
        uniform int isRimlight; // 边缘光
        uniform int isDimtoon; // 硬阴影
        uniform mat4 modelMatrix;
        void main() {        
            // Cel Shading 算法是卡通渲染（Toon Shading）的一种形式，可以有若干种变形
            // 1.指定一个颜色作为苹果的基础颜色；
            // 2.通过光照计算得出每个片元对应的亮度；
            // 3.将亮度由连续的映射到离散的若干个亮度值；
            // 4.将亮度值和基础颜色结合得到片元颜色。
            // 计算基础色
            vec3 albedoColor = texture2D(_MainTex, vUv).rgb; // 片元纹理颜色
            // 计算卡通渲染下的阶梯阴影 - 阶梯式的亮度值
            float diffuse = dot(viewLight, viewNormal); // 计算每个片元的亮度值
            if (diffuse > 0.7) {
                diffuse = 1.0;
            }
            else if (diffuse > 0.3) {
                diffuse = 0.7;
            }
            else {
                diffuse = 0.5;
            }
            
        
            // 计算高光反射值（Phong模型）
            float shininessVal=1.0;
            vec3  specularColor = vec3(1.0, 1.0, 1.0);
            vec3 L = viewLight;
            vec3 R = reflect(-viewLight, viewNormal);   // 计算光源沿法线反射后的方向
            vec3 V = normalize(-viewPosition); // 视图坐标系下，坐标的负值即为视线方向
            float specAngle = max(dot(R, V), 0.0); // 两个方向的夹角（点积）即为高光系数，越接近平行，高光越强烈
            float specularFactor = pow(specAngle, shininessVal); // 镜面反射因子
            // 卡通渲染阶梯化处理
            if (specularFactor > 0.8) {
                specularFactor = 0.5;
            }
            else {
                specularFactor = 0.0;
            }
            if(hasSkinMap == 1){
                float skinMask = texture2D(_skinMap, vUv).r;
                if(skinMask == 1.0){
                    specularFactor = 0.0;
                }
            }
        
            // 计算rim lighting
            vec3 rimColor = vec3(1.0, 0.0, 0.0);
            float rimFactor = 0.5;
            float rimWidth = 1.0;
            float rimAngle = max( dot(viewNormal, V), 0.0); // 简单计算，取视线方向和法线方向的夹角（点积），越接近垂直，越靠近模型边缘
            float rimndotv =  max(0.0, rimWidth - rimAngle);
            // 卡通渲染阶梯化处理
            if (rimndotv > 0.4) {
                rimndotv = 1.0;
            }
            else {
                rimndotv = 0.0;
            }
        
            if(isDimtoon == 0){
                diffuse = 1.0;
            }
            vec3 finalColor = albedoColor * diffuse;
            if(isHighlight == 1){
                finalColor += specularColor * specularFactor;
            }
            if(isRimlight == 1){
                finalColor += rimColor * rimndotv * rimFactor;
            }
            gl_FragColor = vec4( finalColor, 1.0);
        }
    `
// 通常而言，描边是为了增加对比，将物体与背景更强烈地隔离开。
let vertexShaderOutline = `
    uniform float offset;
    void main() {
      vec4 pos = modelViewMatrix * vec4( position + normal * offset, 1.0 );
      gl_Position = projectionMatrix * pos;
    }`
let fragShaderOutline = `
  uniform vec3 color;
    void main(){
      gl_FragColor = vec4( color, 1.0 );
    }`
let vertexShaderMask = `
    uniform float offset;
    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`
let fragShaderMask = `
    void main(){
      gl_FragColor = vec4( 1.0, 1.0, 1.0, 1.0 );
    }`
let vertexShaderEdge = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`;
// 卷积描边：识别数字图像中亮度 【变化明显】 的点
// 边缘检测本质上就是一种滤波算法，区别在于滤波器的选择
// https://zhuanlan.zhihu.com/p/59640437
let fragShaderEdge = `
    uniform sampler2D maskTexture; // 黑白皮卡丘 - 二值图像(黑白图像)
    uniform vec2 texSize; // 纹理大小
    uniform vec3 color; // 描边颜色
    uniform float thickness; // 边框粗细 - 其实就是控制滤波矩阵的范围

    varying vec2 vUv;

    void main() {
        vec2 invSize = thickness / texSize;
        // 采用 Roberts 算子
        vec4 uvOffset = vec4(1.0, 0.0, 0.0, 1.0) * vec4(invSize, invSize);
        // 滤波器-2*2矩阵
        vec4 c1 = texture2D( maskTexture, vUv + uvOffset.xy); // x+1, y
        vec4 c2 = texture2D( maskTexture, vUv - uvOffset.xy); // x-1, y
        vec4 c3 = texture2D( maskTexture, vUv + uvOffset.yw); // x, y+1
        vec4 c4 = texture2D( maskTexture, vUv - uvOffset.yw); // x, y-1
        // r 只有 0/1 两个值
        float diff1 = (c1.r - c2.r)*0.5; // 判断x方向是否属于边缘
        float diff2 = (c3.r - c4.r)*0.5; // 判断y方向是否属于边缘
        
        float d = length(vec2(diff1, diff2)); // 1/0
        // d=1,表示是边缘的点
        gl_FragColor = d > 0.0 ? vec4(color, 1.0) : vec4(0.627, 0.627, 0.627, 0.0);
    }`;
export { vertexShaderToon, fragShaderToon, vertexShaderOutline, fragShaderOutline, vertexShaderMask, fragShaderMask, vertexShaderEdge, fragShaderEdge };