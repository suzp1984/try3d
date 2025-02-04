import Component from "../Component.js";
import Vector3 from "../Math3d/Vector3.js";
import Matrix44 from "../Math3d/Matrix44.js";
import TempVars from "../Util/TempVars.js";
import ShaderSource from "../WebGL/ShaderSource.js";
import Plane from "../Math3d/Plane.js";
import MoreMath from "../Math3d/MoreMath.js";
import Log from "../Util/Log.js";
import Render from "../Render/Render.js";
import Filter from "../Filters/Filter.js";
import Vector2 from "../Math3d/Vector2.js";

/**
 * Camera定义了3D空间中的观察者,渲染3D世界时,3D世界中必须有一个Camera,否则无法渲染。<br/>
 * 除了用于渲染GUI的Picture元素外,3D世界的其他对象被激活的Camera渲染到用户设备中。<br/>
 * @author Kkk
 * @date 2020年10月10日10点35分
 */
export default class Camera extends Component{
    static S_TEMP_MAT4 = new Matrix44();
    static S_TEMP_VEC3 = new Vector3();
    static S_TEMP_VEC3_2 = new Vector3();
    static S_TEMP_VEC3_3 = new Vector3();
    static S_TEMP_VEC3_4 = new Vector3();
    static S_CAMERA_UPDATE_EVENT = 'camera_update_event';

    // 视锥包含标记
    // 相交
    static S_FRUSTUM_INTERSECT_INTERSECTS = 0;
    // 包含
    static S_FRUSTUM_INTERSECT_INSIDE = 1;
    // 不包含
    static S_FRUSTUM_INTERSECT_OUTSIDE = 2;

    // 视锥体索引
    static S_LEFT_PLANE = 0;
    static S_RIGHT_PLANE = 1;
    static S_BOTTOM_PLANE = 2;
    static S_TOP_PLANE = 3;
    static S_FAR_PLANE = 4;
    static S_NEAR_PLANE = 5;
    constructor(owner, cfg) {
        super(owner, cfg);
        this._m_Eye = new Vector3(0, 0, 10);
        this._m_At = new Vector3(0, 0, -10);
        this._m_Up = new Vector3(0, 1, 0);
        this._m_Left = new Vector3(1, 0, 0);
        this._m_Dir = new Vector3();
        this._m_ViewMatrix = new Matrix44();
        this._m_ProjectMatrix = new Matrix44();
        this._m_ProjectViewMatrix = new Matrix44();
        this._m_ViewMatrixUpdate = false;
        this._m_ProjectMatrixUpdate = false;
        this._m_ProjectViewMatrixUpdate = false;
        this._m_ParallelProjection = cfg.parallelProjection != null ? cfg.parallelProjection : false;

        // 相机参数
        this._m_Fovy = cfg.fovy || 45.0;
        this._m_FixedAspect = cfg.aspect != null ? cfg.aspect : false;

        // 如果当前相机是一个主相机,则被激活用于主渲染
        this._m_IsRenderingCamera = false;


        // Frustum6个平面
        this._m_FrustumPlane = [];
        for(let i = 0;i < 6;i++){
            this._m_FrustumPlane.push(new Plane());
        }

        // Frustum6截面距离
        // 相机到Near截面的距离
        this._m_FrustumNear = 0.1;
        // 相机到Far截面的距离
        this._m_FrustumFar = 1000;
        // 相机到Left截面的距离
        this._m_FrustumLeft = 0;
        // 相机到Right截面的距离
        this._m_FrustumRight = 0;
        // 相机到Top截面的距离
        this._m_FrustumTop = 0;
        // 相机到Bottom截面的距离
        this._m_FrustumBottom = 0;
        // 分辨率倒数
        this._m_ResolutionInverse = new Vector2();

        // 缓存变量
        this._m_CoeffLeft = new Array(2).fill(0);
        this._m_CoeffRight = new Array(2).fill(0);
        this._m_CoeffBottom = new Array(2).fill(0);
        this._m_CoeffTop = new Array(2).fill(0);

        // 计算标记
        this._m_FrustumMask = 0;


        // 初始化(默认是一个透视相机)
        let canvas = this._m_Scene.getCanvas();
        let gl = canvas.getGLContext();
        this._m_Width = cfg.width || canvas.getWidth();
        this._m_Height = cfg.height || canvas.getHeight();
        this._m_FixedSize = cfg.fixedSize != null ? cfg.fixedSize : false;
        this._m_ViewMatrix.lookAt(this._m_Eye, this._m_At, this._m_Up);
        // this._m_ProjectMatrix.perspectiveM(this._m_Fovy, this._m_FixedAspect ? this._m_FixedAspect : (this._m_Width * 1.0 / this._m_Height), 0.1, 1000);
        this._m_ViewMatrixUpdate = true;
        this._m_ProjectMatrixUpdate = true;
        this._m_UpdateCameraPosition = true;
        gl.viewport(0, 0, this._m_Width, this._m_Height);
        this._m_Scene.getRender().getFrameContext().m_LastWidth = this._m_Width;
        this._m_Scene.getRender().getFrameContext().m_LastHeight = this._m_Height;
        this._init();

        canvas.on('resize', ()=>{
            if(!this._m_FixedSize){
                this._m_Width = canvas.getWidth();
                this._m_Height = canvas.getHeight();
                if(this._m_IsRenderingCamera){
                    gl.viewport(0, 0, this._m_Width, this._m_Height);
                    this._m_ResolutionInverse.setToInXY(1.0 / this._m_Width, 1.0 / this._m_Height);
                    let frameContext = this._m_Scene.getRender().getFrameContext();
                    frameContext.m_LastWidth = this._m_Width;
                    frameContext.m_LastHeight = this._m_Height;
                    if(frameContext.getContext(ShaderSource.S_RESOLUTION_INVERSE)){
                        // viewport相关信息(理论上,viewport应该独立封装一个类,但是这里简单包装在camera中)
                        gl.bindBuffer(gl.UNIFORM_BUFFER, this.VIEW_PORT);
                        gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this._m_ResolutionInverse.getBufferData());
                        gl.bindBuffer(gl.UNIFORM_BUFFER, null);
                    }
                }
                // 直接展开而非函数调用,减少开销
                if(this._m_ParallelProjection){
                    this._m_ProjectMatrix.parallelM(this._m_FrustumLeft, this._m_FrustumRight, this._m_FrustumTop, this._m_FrustumBottom, this._m_FrustumNear, this._m_FrustumFar);
                }
                else{
                    this.setFrustumPerspective(this._m_Fovy, this._m_FixedAspect ? this._m_FixedAspect : (this._m_Width * 1.0 / this._m_Height), this._m_FrustumNear, this._m_FrustumFar);
                    // this._m_ProjectMatrix.perspectiveM(this._m_Fovy, this._m_FixedAspect ? this._m_FixedAspect : (this._m_Width * 1.0 / this._m_Height), this._m_FrustumNear, this._m_FrustumFar);
                }
                this._m_ProjectMatrixUpdate = true;
            }
            this._doUpdate();
        });

        // FilterPost
        this._m_Filters = [];

        // postFilter
        this._m_Scene.getRender().on(Render.POST_QUEUE, (renderQueue)=>{
            if(this._m_IsRenderingCamera){
                if(this.demandFilter()){
                    this._m_Filters.forEach(filter=>{
                        if(filter.isEnable()){
                            filter.preFrame();
                        }
                    });
                }
            }
        });
        this._m_Scene.getRender().on(Render.POST_FRAME, (exTime)=>{
            if(this._m_IsRenderingCamera){
                if(this.demandFilter()){
                    let len = this._m_Filters.length;
                    let i = 0;
                    this._m_Filters.forEach(filter=>{
                        i++;
                        if(filter.isEnable()){
                            filter.postFilter();
                            // 更新缓冲区
                            if(i < len)
                                this._m_Scene.getRender().swapPostFilter();
                        }
                    });
                }
            }
        });
    }

    /**
     * 初始化。<br/>
     * @private
     */
    _init(){
        if(this._m_ParallelProjection){
            // 默认初始化的平行投影视锥
            this._m_FrustumNear = 1.0;
            this._m_FrustumFar = 2.0;
            this._m_FrustumLeft = -0.5;
            this._m_FrustumRight = 0.5;
            this._m_FrustumTop = 0.5;
            this._m_FrustumBottom = -0.5;
            this._m_ProjectMatrix.parallelM(this._m_FrustumLeft, this._m_FrustumRight, this._m_FrustumTop, this._m_FrustumBottom, this._m_FrustumNear, this._m_FrustumFar);
        }
        else{
            // 默认是一个透视相机,所以这里基于透视算法建立投影平面
            // 这里直接基于fovY(45),near=0.1和far1000预建
            let defaultAspect = this._m_Width * 1.0 / this._m_Height;
            let h = Math.tan(MoreMath.toRadians(this._m_Fovy) * 0.5) * 0.1;
            let w = h * defaultAspect;
            Log.debug("w:" + w + ";h:" + h + ";as:" + defaultAspect);
            this._m_FrustumLeft = -w;
            this._m_FrustumRight = w;
            this._m_FrustumBottom = -h;
            this._m_FrustumTop = h;
            this._m_FrustumNear = 0.1;
            this._m_FrustumFar = 1000;
            this._m_ProjectMatrix.perspectiveM(this._m_Fovy, this._m_FixedAspect ? this._m_FixedAspect : (this._m_Width * 1.0 / this._m_Height), this._m_FrustumNear, this._m_FrustumFar);
        }


        // 预建缓存
        let frameContext = this._m_Scene.getRender().getFrameContext();
        let gl = this._m_Scene.getCanvas().getGLContext();
        if(!frameContext.getContextBlock('MAT')){
            let MAT = gl.createBuffer();
            this.MAT = MAT;
            gl.bindBuffer(gl.UNIFORM_BUFFER, MAT);
            gl.bufferData(gl.UNIFORM_BUFFER, 3 * 16 * 4, gl.STATIC_DRAW);
            gl.bindBuffer(gl.UNIFORM_BUFFER, null);

            gl.bindBufferRange(gl.UNIFORM_BUFFER, ShaderSource.BLOCKS['MAT'].blockIndex, MAT, 0, 3 * 16 * 4);
            frameContext.addContextBlock('MAT', this.MAT);
        }
        else{
            this.MAT = frameContext.getContextBlock('MAT');
        }
        if(!frameContext.getContextBlock('VIEW')){
            let VIEW = gl.createBuffer();
            this.VIEW = VIEW;
            gl.bindBuffer(gl.UNIFORM_BUFFER, VIEW);
            gl.bufferData(gl.UNIFORM_BUFFER, 3 * 4, gl.STATIC_DRAW);
            gl.bindBuffer(gl.UNIFORM_BUFFER, null);

            gl.bindBufferRange(gl.UNIFORM_BUFFER, ShaderSource.BLOCKS['VIEW'].blockIndex, VIEW, 0, 3 * 4);
            frameContext.addContextBlock('VIEW', this.VIEW);
        }
        else{
            this.VIEW = frameContext.getContextBlock('VIEW');
        }
        if(!frameContext.getContextBlock('VIEW_PORT')){
            let VIEW_PORT = gl.createBuffer();
            this.VIEW_PORT = VIEW_PORT;
            gl.bindBuffer(gl.UNIFORM_BUFFER, VIEW_PORT);
            gl.bufferData(gl.UNIFORM_BUFFER, 2 * 4, gl.STATIC_DRAW);
            gl.bindBuffer(gl.UNIFORM_BUFFER, null);

            gl.bindBufferRange(gl.UNIFORM_BUFFER, ShaderSource.BLOCKS['VIEW_PORT'].blockIndex, VIEW_PORT, 0, 2 * 4);
            frameContext.addContextBlock('VIEW_PORT', this.VIEW_PORT);
        }
        else{
            this.VIEW_PORT = frameContext.getContextBlock('VIEW_PORT');
        }
        this._m_ResolutionInverse.setToInXY(1.0 / this._m_Width, 1.0 / this._m_Height);
        if(frameContext.getContext(ShaderSource.S_RESOLUTION_INVERSE)){
            // viewport相关信息(理论上,viewport应该独立封装一个类,但是这里简单包装在camera中)
            gl.bindBuffer(gl.UNIFORM_BUFFER, this.VIEW_PORT);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this._m_ResolutionInverse.getBufferData());
            gl.bindBuffer(gl.UNIFORM_BUFFER, null);
        }

        this._doUpdate();
    }

    /**
     * 返回视野角度。<br/>
     * @return {Number}
     */
    getFov(){
        return this._m_Fovy;
    }

    /**
     * 返回视野弧度。<br/>
     * @return {Number}
     */
    getFovy(){
        return MoreMath.toRadians(this._m_Fovy);
    }

    /**
     * 设置锥体截面。<br/>
     * @param {Number}[left]
     * @param {Number}[right]
     * @param {Number}[top]
     * @param {Number}[bottom]
     * @param {Number}[near]
     * @param {Number}[far]
     */
    setFrustum(left, right, top, bottom, near, far){
        this._m_FrustumNear = near;
        this._m_FrustumFar = far;
        this._m_FrustumLeft = left;
        this._m_FrustumRight = right;
        this._m_FrustumTop = top;
        this._m_FrustumBottom = bottom;
        this._m_ProjectMatrix.fromFrustum(this._m_FrustumLeft, this._m_FrustumRight, this._m_FrustumTop, this._m_FrustumBottom, this._m_FrustumNear, this._m_FrustumFar, this._m_ParallelProjection);
    }

    /**
     * 根据视角fovy,视口aspect,视锥near与far设置透视投影矩阵。<br/>
     * @param {Number}[fovy]
     * @param {Number}[aspect]
     * @param {Number}[near]
     * @param {Number}[far]
     */
    setFrustumPerspective(fovy, aspect, near, far){
        // 无论如何,调用这个方法意味着变成了透视投影相机
        this._m_ParallelProjection = false;


        this._m_Fovy = fovy;
        // this._m_FixedAspect = aspect;
        let h = Math.tan(MoreMath.toRadians(this._m_Fovy) * 0.5) * near;
        let w = h * aspect;
        // Log.debug("w:" + w + ";h:" + h + ";as:" + this._m_FixedAspect);
        this._m_FrustumLeft = -w;
        this._m_FrustumRight = w;
        this._m_FrustumBottom = -h;
        this._m_FrustumTop = h;
        this._m_FrustumNear = near;
        this._m_FrustumFar = far;
        this._m_ProjectMatrix.perspectiveM(this._m_Fovy, aspect, this._m_FrustumNear, this._m_FrustumFar);
    }

    /**
     * 强行更行投影矩阵。<br/>
     */
    forceUpdateProjection(){
        if(this._m_ParallelProjection){
            this._m_ProjectMatrix.parallelM(this._m_FrustumLeft, this._m_FrustumRight, this._m_FrustumTop, this._m_FrustumBottom, this._m_FrustumNear, this._m_FrustumFar);
        }
        else{
            this._m_ProjectMatrix.perspectiveM(this._m_Fovy, this._m_FixedAspect ? this._m_FixedAspect : (this._m_Width * 1.0 / this._m_Height), this._m_FrustumNear, this._m_FrustumFar);
        }
    }

    /**
     * 添加一个后处理。<br/>
     * @param {Material}[material]
     */
    addFilterFromMaterial(material){
        let newFilter = Filter.newFilterFromMaterial(this, material);
        this._m_Filters.push(newFilter);
        return newFilter;
    }

    /**
     * 添加一个场景处理器。<br/>
     * @param {Object}[filter]
     * @param {Number}[priority 优先级]
     */
    addFilter(filter, priority){
        let cur = [];
        let i = 0;
        for(let len = Math.min(priority, this._m_Filters.length);i < len;i++){
            cur.push(this._m_Filters[i]);
        }
        cur.push(filter);
        for(let len = this._m_Filters.length;i < len;i++){
            cur.push(this._m_Filters[i]);
        }
        this._m_Filters = cur;
    }

    /**
     * 返回所有后处理器。<br/>
     * @return {Filter[]}
     */
    getFilters(){
        return this._m_Filters;
    }

    /**
     * 要求后处理。<br/>
     * @return {Boolean}
     */
    demandFilter(){
        return this._m_Filters != null && this._m_Filters.length > 0;
    }

    /**
     * 返回Left截面。<br/>
     * @return {Number}
     */
    getLeft(){
        return this._m_FrustumLeft;
    }

    /**
     * 返回Right截面。<br/>
     *@return {Number}
     */
    getRight(){
        return this._m_FrustumRight;
    }

    /**
     * 返回Top截面。<br/>
     * @return {Number}
     */
    getTop(){
        return this._m_FrustumTop;
    }

    /**
     * 返回Bottom截面。<br/>
     * @return {Number}
     */
    getBottom(){
        return this._m_FrustumBottom;
    }

    /**
     * 返回Near截面。<br/>
     * @return {Number}
     */
    getNear(){
        return this._m_FrustumNear;
    }

    /**
     * 返回Far截面。<br/>
     * @return {Number}
     */
    getFar(){
        return this._m_FrustumFar;
    }

    /**
     * 设置Far截面。<br/>
     * @param {Number}[far]
     */
    setFar(far){
        this._m_FrustumFar = far;
    }

    /**
     * 设置为渲染相机。<br/>
     * @param {Boolean}[isMainCamera]
     */
    setIsRenderingCamera(isMainCamera){
        this._m_IsRenderingCamera = isMainCamera;
        this._m_UpdateCameraPosition = true;
        this._m_ViewMatrixUpdate = true;
        this._m_ProjectMatrixUpdate = true;
        this._m_ProjectViewMatrixUpdate = true;
        if(isMainCamera){
            // 更新一次数据,避免延帧渲染
            this._doUpdate(true);
        }
    }

    /**
     * 返回指定的视锥体平面。<br/>
     * @param {Number}[planeId 参考Camera的常量]
     * @return {*}
     */
    getFrustumPlane(planeId){
        return this._m_FrustumPlane[planeId];
    }

    /**
     * 返回视锥体掩码。<br/>
     * @return {Number}
     */
    getFrustumMask(){
        return this._m_FrustumMask;
    }

    /**
     * 设置视锥体掩码，以便加速剔除。<br/>
     * @param {Number}[frustumMask]
     */
    setFrustumMask(frustumMask){
        this._m_FrustumMask = frustumMask;
    }

    /**
     * 返回观察点。<br/>
     * @returns {Vector3}[at]
     */
    getAt(){
        return this._m_At;
    }

    /**
     * 设置观察点。<br/>
     * @param {Vector3}[at]
     */
    setAt(at){
        this._m_At.setTo(at);
    }

    /**
     * 返回相机位置。<br/>
     * @returns {Vector3}[eye]
     */
    getEye(){
        return this._m_Eye;
    }

    /**
     * 设置相机位置。<br/>
     * @param {Vector3}[eye]
     */
    setEye(eye){
        this._m_Eye.setTo(eye);
    }

    /**
     * 返回相机抬头朝向。<br/>
     * @returns {Vector3}[up]
     */
    getUp(){
        return this._m_Up;
    }

    /**
     * 设置相机抬头朝向。<br/>
     * @param {Vector3}[up]
     */
    setUp(up){
        this._m_Up.setTo(up);
    }

    /**
     * 返回方向。<br/>
     * @return {Vector3}
     */
    getDir(){
        return this._m_Dir;
    }

    /**
     * 返回相机左轴。<br/>
     * @return {Vector3}
     */
    getCamLeft(){
        return this._m_Left;
    }

    /**
     * 设置镜头eye,at,up。<br/>
     * @param {Vector3}[eye]
     * @param {Vector3}[at]
     * @param {Vector3}[up]
     */
    lookAt(eye, at, up){
        this._m_Eye.setTo(eye);
        this._m_At.setTo(at);
        this._m_At.sub(this._m_Eye, this._m_Dir);
        this._m_Dir.normal();
        up.cross(this._m_Dir, Camera.S_TEMP_VEC3).normal();
        this._m_Left.setTo(Camera.S_TEMP_VEC3).normal();
        this._m_Dir.cross(Camera.S_TEMP_VEC3, this._m_Up).normal();
        // this._m_Up.setTo(up);
        this._m_ViewMatrix.lookAt(this._m_Eye, this._m_At, this._m_Up);
        this._m_ViewMatrixUpdate = true;
        this._doUpdate();
    }

    /**
     * 是否为平行投影相机。<br/>
     * @return {Boolean}
     */
    isParallelProjection(){
        return this._m_ParallelProjection;
    }

    /**
     * 更新视锥体。<br/>
     * @private
     */
    _updateFrustum(){
        // 计算更新变量
        if(this._m_ParallelProjection){
            // 这里根据相机类型更新计算变量(透视和平行相机计算方式不同)
            this._m_CoeffLeft[0] = 1.0;
            this._m_CoeffLeft[1] = 0.0;

            this._m_CoeffRight[0] = -1.0;
            this._m_CoeffRight[1] = 0.0;

            this._m_CoeffBottom[0] = 1.0;
            this._m_CoeffBottom[1] = 0.0;

            this._m_CoeffTop[0] = -1.0;
            this._m_CoeffTop[1] = 0.0;
        }
        else{
            // 这里根据相机类型更新计算变量(透视和平行相机计算方式不同)
            let nearSquared = this._m_FrustumNear * this._m_FrustumNear;
            let leftSquared = this._m_FrustumLeft * this._m_FrustumLeft;
            let rightSquared = this._m_FrustumRight * this._m_FrustumRight;
            let bottomSquared = this._m_FrustumBottom * this._m_FrustumBottom;
            let topSquared = this._m_FrustumTop * this._m_FrustumTop;

            let inverseLength = 1.0 / Math.sqrt(nearSquared + leftSquared);
            this._m_CoeffLeft[0] = -this._m_FrustumNear * inverseLength;
            this._m_CoeffLeft[1] = -this._m_FrustumLeft * inverseLength;

            inverseLength = 1.0 / Math.sqrt(nearSquared + rightSquared);
            this._m_CoeffRight[0] = this._m_FrustumNear * inverseLength;
            this._m_CoeffRight[1] = this._m_FrustumRight * inverseLength;

            inverseLength = 1.0 / Math.sqrt(nearSquared + bottomSquared);
            this._m_CoeffBottom[0] = this._m_FrustumNear * inverseLength;
            this._m_CoeffBottom[1] = -this._m_FrustumBottom * inverseLength;

            inverseLength = 1.0 / Math.sqrt(nearSquared + topSquared);
            this._m_CoeffTop[0] = -this._m_FrustumNear * inverseLength;
            this._m_CoeffTop[1] = this._m_FrustumTop * inverseLength;
        }

        // 更新视锥体6平面
        Camera.S_TEMP_VEC3.setToInXYZ(-this._m_ViewMatrix.m[0], -this._m_ViewMatrix.m[4], -this._m_ViewMatrix.m[8]);
        Camera.S_TEMP_VEC3_2.setToInXYZ(this._m_ViewMatrix.m[1], this._m_ViewMatrix.m[5], this._m_ViewMatrix.m[9]);
        Camera.S_TEMP_VEC3_3.setTo(this._m_Dir);

        let dirDotEye = Camera.S_TEMP_VEC3_3.dot(this._m_Eye);

        // left plane
        let leftPlaneNormal = this._m_FrustumPlane[Camera.S_LEFT_PLANE].getNormal();
        leftPlaneNormal._m_X = Camera.S_TEMP_VEC3._m_X * this._m_CoeffLeft[0];
        leftPlaneNormal._m_Y = Camera.S_TEMP_VEC3._m_Y * this._m_CoeffLeft[0];
        leftPlaneNormal._m_Z = Camera.S_TEMP_VEC3._m_Z * this._m_CoeffLeft[0];
        leftPlaneNormal.addInXYZ(Camera.S_TEMP_VEC3_3._m_X * this._m_CoeffLeft[1], Camera.S_TEMP_VEC3_3._m_Y * this._m_CoeffLeft[1], Camera.S_TEMP_VEC3_3._m_Z * this._m_CoeffLeft[1]);
        this._m_FrustumPlane[Camera.S_LEFT_PLANE].setD(this._m_Eye.dot(leftPlaneNormal));

        // right plane
        let rightPlaneNormal = this._m_FrustumPlane[Camera.S_RIGHT_PLANE].getNormal();
        rightPlaneNormal._m_X = Camera.S_TEMP_VEC3._m_X * this._m_CoeffRight[0];
        rightPlaneNormal._m_Y = Camera.S_TEMP_VEC3._m_Y * this._m_CoeffRight[0];
        rightPlaneNormal._m_Z = Camera.S_TEMP_VEC3._m_Z * this._m_CoeffRight[0];
        rightPlaneNormal.addInXYZ(Camera.S_TEMP_VEC3_3._m_X * this._m_CoeffRight[1], Camera.S_TEMP_VEC3_3._m_Y * this._m_CoeffRight[1], Camera.S_TEMP_VEC3_3._m_Z * this._m_CoeffRight[1]);
        this._m_FrustumPlane[Camera.S_RIGHT_PLANE].setD(this._m_Eye.dot(rightPlaneNormal));

        // bottom plane
        let bottomPlaneNormal = this._m_FrustumPlane[Camera.S_BOTTOM_PLANE].getNormal();
        bottomPlaneNormal._m_X = Camera.S_TEMP_VEC3_2._m_X * this._m_CoeffBottom[0];
        bottomPlaneNormal._m_Y = Camera.S_TEMP_VEC3_2._m_Y * this._m_CoeffBottom[0];
        bottomPlaneNormal._m_Z = Camera.S_TEMP_VEC3_2._m_Z * this._m_CoeffBottom[0];
        bottomPlaneNormal.addInXYZ(Camera.S_TEMP_VEC3_3._m_X * this._m_CoeffBottom[1], Camera.S_TEMP_VEC3_3._m_Y * this._m_CoeffBottom[1], Camera.S_TEMP_VEC3_3._m_Z * this._m_CoeffBottom[1]);
        this._m_FrustumPlane[Camera.S_BOTTOM_PLANE].setD(this._m_Eye.dot(bottomPlaneNormal));

        // top plane
        let topPlaneNormal = this._m_FrustumPlane[Camera.S_TOP_PLANE].getNormal();
        topPlaneNormal._m_X = Camera.S_TEMP_VEC3_2._m_X * this._m_CoeffTop[0];
        topPlaneNormal._m_Y = Camera.S_TEMP_VEC3_2._m_Y * this._m_CoeffTop[0];
        topPlaneNormal._m_Z = Camera.S_TEMP_VEC3_2._m_Z * this._m_CoeffTop[0];
        topPlaneNormal.addInXYZ(Camera.S_TEMP_VEC3_3._m_X * this._m_CoeffTop[1], Camera.S_TEMP_VEC3_3._m_Y * this._m_CoeffTop[1], Camera.S_TEMP_VEC3_3._m_Z * this._m_CoeffTop[1]);
        this._m_FrustumPlane[Camera.S_TOP_PLANE].setD(this._m_Eye.dot(topPlaneNormal));

        // 如果是平行投影的话,需要修正left,right,top,bottom的边界
        if(this._m_ParallelProjection){
            this._m_FrustumPlane[Camera.S_LEFT_PLANE].setD(this._m_FrustumPlane[Camera.S_LEFT_PLANE].getD() + this._m_FrustumLeft);
            this._m_FrustumPlane[Camera.S_RIGHT_PLANE].setD(this._m_FrustumPlane[Camera.S_RIGHT_PLANE].getD() - this._m_FrustumRight);
            this._m_FrustumPlane[Camera.S_TOP_PLANE].setD(this._m_FrustumPlane[Camera.S_TOP_PLANE].getD() - this._m_FrustumTop);
            this._m_FrustumPlane[Camera.S_BOTTOM_PLANE].setD(this._m_FrustumPlane[Camera.S_BOTTOM_PLANE].getD() + this._m_FrustumBottom);
        }

        // far plane
        this._m_FrustumPlane[Camera.S_FAR_PLANE].setNormaXYZ(-Camera.S_TEMP_VEC3_3._m_X, -Camera.S_TEMP_VEC3_3._m_Y, -Camera.S_TEMP_VEC3_3._m_Z);
        this._m_FrustumPlane[Camera.S_FAR_PLANE].setD(-(dirDotEye + this._m_FrustumFar));

        // near plane
        this._m_FrustumPlane[Camera.S_NEAR_PLANE].setNormaXYZ(Camera.S_TEMP_VEC3_3._m_X, Camera.S_TEMP_VEC3_3._m_Y, Camera.S_TEMP_VEC3_3._m_Z);
        this._m_FrustumPlane[Camera.S_NEAR_PLANE].setD(dirDotEye + this._m_FrustumNear);

        // console.log("6平面:",this._m_FrustumPlane);
        // console.log("left:" + Camera.S_TEMP_VEC3.toString());
        // console.log("up:" + Camera.S_TEMP_VEC3_2.toString());
        // console.log("dir:" + Camera.S_TEMP_VEC3_3.toString());
        // console.log("pos:" + this._m_Eye.toString());
        // console.log("viewMatrix:" + this._m_ViewMatrix.toString());
    }

    /**
     * 更新相机。<br/>
     * @private
     */
    _update(){
        let gl = this._m_Scene.getCanvas().getGLContext();
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.MAT);

        let frameContext = this._m_Scene.getRender().getFrameContext();

        if(this._m_ViewMatrixUpdate){
            this._m_UpdateCameraPosition = true;
            this._m_ProjectViewMatrixUpdate = true;
            if(frameContext.getContext(ShaderSource.S_VIEW_MATRIX_SRC) || frameContext.getContext(ShaderSource.S_VP_SRC) || frameContext.getContext(ShaderSource.S_MVP_SRC)){
                if(this._m_IsRenderingCamera){
                    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this._m_ViewMatrix.getBufferData());
                    frameContext.setCalcContext(ShaderSource.S_VIEW_MATRIX_SRC, this._m_ViewMatrix);
                }
                this._m_ViewMatrixUpdate = false;
            }
        }
        if(this._m_ProjectMatrixUpdate){
            this._m_ProjectViewMatrixUpdate = true;
            if(frameContext.getContext(ShaderSource.S_PROJECT_MATRIX_SRC) || frameContext.getContext(ShaderSource.S_VP_SRC) || frameContext.getContext(ShaderSource.S_MVP_SRC)){
                if(this._m_IsRenderingCamera){
                    gl.bufferSubData(gl.UNIFORM_BUFFER, 16 * 4, this._m_ProjectMatrix.getBufferData());
                    frameContext.setCalcContext(ShaderSource.S_PROJECT_MATRIX_SRC, this._m_ProjectMatrix);
                }
                this._m_ProjectMatrixUpdate = false;
            }
        }

        // 检测其他需要的context
        if(this._m_ProjectViewMatrixUpdate && frameContext.getContext(ShaderSource.S_VP_SRC)){
            Matrix44.multiplyMM(this._m_ProjectViewMatrix, 0, this._m_ProjectMatrix, 0, this._m_ViewMatrix, 0);
            if(this._m_IsRenderingCamera){
                gl.bufferSubData(gl.UNIFORM_BUFFER, 32 * 4, this._m_ProjectViewMatrix.getBufferData());
                frameContext.setCalcContext(ShaderSource.S_VP_SRC, this._m_ProjectViewMatrix);
            }
            this._m_ProjectViewMatrixUpdate = false;
        }
        gl.bindBuffer(gl.UNIFORM_BUFFER, null);

        // view
        if(this._m_UpdateCameraPosition){
            if(frameContext.getContext(ShaderSource.S_CAMERA_POSITION_SRC)){
                if(this._m_IsRenderingCamera){
                    // camera相关信息
                    gl.bindBuffer(gl.UNIFORM_BUFFER, this.VIEW);
                    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this._m_Eye.getBufferData());
                    gl.bindBuffer(gl.UNIFORM_BUFFER, null);
                }
                this._m_UpdateCameraPosition = false;
            }
        }

        // viewport
        if(frameContext.getContext(ShaderSource.S_RESOLUTION_INVERSE)){
            // viewport相关信息(理论上,viewport应该独立封装一个类,但是这里简单包装在camera中)
            gl.bindBuffer(gl.UNIFORM_BUFFER, this.VIEW_PORT);
            gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this._m_ResolutionInverse.getBufferData());
            gl.bindBuffer(gl.UNIFORM_BUFFER, null);
        }

        if(this._m_ViewMatrixUpdate || this._m_ProjectMatrixUpdate || this._m_ProjectViewMatrixUpdate){
            this._doUpdate();
        }

        // 更新视锥体(这里应该使用一个标记变量检测是否应该更新,但是现在暂时在每次_update()里调用更新Frustum)
        this._updateFrustum();
        this.fire(Camera.S_CAMERA_UPDATE_EVENT, [this._m_ViewMatrix, this._m_ProjectMatrix, this._m_ProjectViewMatrix]);
    }

    /**
     * 设置视图矩阵。<br/>
     * @param {Matrix44}[viewMatrix]
     */
    setViewMatrix(viewMatrix){
        this._m_ViewMatrix.set(viewMatrix);
        // 从矩阵中计算eye,at,up
        // 可能每次更新矩阵时这么去处理开销有点大,所以要更新物体时,最好调用Camera.lookAt(),而不是该方法
        let g = this._m_ViewMatrix.inertRetNew(TempVars.S_TEMP_MAT4);
        if(g){
            this._m_Eye.setToInXYZ(g.m[12], g.m[13], g.m[14]);
            this._m_Up.setToInXYZ(g.m[4], g.m[5], g.m[6]);
            this._m_Left.setToInXYZ(g.m[0], g.m[1], g.m[2]);
            // 别忘了ndc是右手
            TempVars.S_TEMP_VEC3.setToInXYZ(-g.m[8], -g.m[9], -g.m[10]);
            TempVars.S_TEMP_VEC3.add(this._m_Eye, this._m_At);
            this._m_At.sub(this._m_Eye, this._m_Dir);
            this._m_Dir.normal();
        }
        this._m_ViewMatrixUpdate = true;
        this._doUpdate();
    }

    /**
     * 获取视图矩阵。<br/>
     * @returns {Matrix44}[viewMatrix]
     */
    getViewMatrix(){
        return this._m_ViewMatrix;
    }

    /**
     * 返回投影视图矩阵。<br/>
     * @param {Boolean}[ref 由于ProjectViewMatrix根据渲染引擎自动计算，但有时并非用到，所以这里可以强制计算]
     * @return {Matrix44}
     */
    getProjectViewMatrix(ref){
        if(ref){
            Matrix44.multiplyMM(this._m_ProjectViewMatrix, 0, this._m_ProjectMatrix, 0, this._m_ViewMatrix, 0);
        }
        return this._m_ProjectViewMatrix;
    }

    /**
     * 设置投影矩阵。<br/>
     * @param {Matrix44}[projectMatrix]
     */
    setProjectMatrix(projectMatrix){
        this._m_ProjectMatrix.set(projectMatrix);
        this._m_ProjectMatrixUpdate = true;
        this._doUpdate();
    }

    /**
     * 返回相机高度。<br/>
     * @return {Number}
     */
    getHeight(){
        // let canvas = this._m_Scene.getCanvas();
        // return canvas.getHeight();
        return this._m_Height;
    }

    /**
     * 返回当前相机宽度。<br/>
     * @return {Number}
     */
    getWidth(){
        // let canvas = this._m_Scene.getCanvas();
        // return canvas.getWidth();
        return this._m_Width;
    }

    /**
     * 滚动相机。
     * @param {Number}[zoom 滚动量,非累计量]
     */
    scroll(zoom){
        this._m_ProjectMatrix.perspectiveM(zoom, this._m_Width * 1.0 / this._m_Height, this._m_FrustumNear, this._m_FrustumFar);
        this._m_ProjectMatrixUpdate = true;
        this._doUpdate();
    }

    /**
     * 返回投影矩阵。<br/>
     * @returns {Matrix44}[projectMatrix]
     */
    getProjectMatrix(){
        return this._m_ProjectMatrix;
    }

    /**
     * 判断一个包围体与视锥体的包含关系。<br/>
     * @param {BoundingVolume}[boundingVolume]
     * @return {Number}[返回Camera.S_FRUSTUM_INTERSECT_INSIDE(包含),Camera.S_FRUSTUM_INTERSECT_OUTSIDE(不包含)以及Camera.S_FRUSTUM_INTERSECT_INSIDE(相交)]
     */
    frustumContains(boundingVolume){
        // 检测当前包围体是否处于视锥体中
        // 不同包围体使用不同的算法进行
        if(boundingVolume){
            // 判断与视锥体6平面关系
            let mask = 0;
            let planeId = 0;
            let side = 0;
            let contains = Camera.S_FRUSTUM_INTERSECT_INSIDE;

            for(let i = 6;i >= 0;i--){
                if(i == boundingVolume.getPriorityPlane()){
                    continue;
                }

                // 获取优先检测面
                planeId = (i == 6) ? boundingVolume.getPriorityPlane() : i;

                mask = 1 << planeId;

                // 判断是否经过检测
                if((this._m_FrustumMask & mask) == 0){
                    // 检测该截面
                    side = boundingVolume.whichSide(this._m_FrustumPlane[planeId]);

                    if(side == Plane.S_SIDE_NEGATIVE){
                        // 只要处于任意一个截面的外部,则表明该节点应该被剔除
                        // 下次优先检测剔除截面
                        boundingVolume.setPriorityPlane(planeId);
                        return Camera.S_FRUSTUM_INTERSECT_OUTSIDE;
                    }
                    else if(side == Plane.S_SIDE_POSITIVE){
                        // 说明有至少位于某个截面正面
                        // 子节点跳过这个截面,因为已经检测过该截面
                        this._m_FrustumMask |= mask;
                    }
                    else{
                        // 当前与截面相交
                        contains = Camera.S_FRUSTUM_INTERSECT_INTERSECTS;
                    }
                }
            }

            return contains;
        }
        else{
            // 如果没有包围体,当作包含处理(当理论上,该叶子节点是一个不需要渲染的node)
            return Camera.S_FRUSTUM_INTERSECT_INSIDE;
        }
    }

    /**
     * 从平面空间坐标以及z投射计算并返回世界中的坐标。<br/>
     * screenPosition.x表示屏幕上面0-width之间的位置值,screenPosition.y表示屏幕上面0-height之间的位置值。<br/>
     * 其中中心点在屏幕中间，对于z投射，0-1表示分布在近截面与远界面的非线性投射，为1时表示完全投射到屏幕边界，为0时表示投射到屏幕中心点。<br/>
     * @param {Vector2}[screenPosition 屏幕空间坐标]
     * @param {Number}[projectionZPos z投射]
     * @param {Boolean}[viewSpace true表示计算基于viewSpace]
     * @param {Vector3}[result 计算结果]
     * @return {Vector3}
     */
    getWorldCoordinates(screenPosition, projectionZPos, viewSpace, result){
        if(!result){
            result = new Vector3();
        }

        // 由于没有强制更新ProjectViewMatrix,所以需要在这里进行计算(这一部分可以优化)
        if(viewSpace){
            Matrix44.multiplyMM(this._m_ProjectViewMatrix, 0, this._m_ProjectMatrix, 0, this._m_ViewMatrix, 0);
            Camera.S_TEMP_MAT4.set(this._m_ProjectViewMatrix);
        }
        else{
            Camera.S_TEMP_MAT4.set(this._m_ProjectMatrix);
        }
        // 逆矩阵
        Camera.S_TEMP_MAT4.inert();

        // 计算世界坐标
        let w = this.getWidth();
        let h = this.getHeight();
        // 视口以左下角原点(但位于屏幕中心)
        let viewPortLeft = 0.0;
        let viewPortBottom = 0.0;
        let viewPortRight = 1.0;
        let viewPortTop = 1.0;
        // 变换回NDC空间
        Camera.S_TEMP_VEC3.setToInXYZ((screenPosition._m_X / w - viewPortLeft) / (viewPortRight - viewPortLeft) * 2 - 1, (screenPosition._m_Y / h - viewPortBottom) / (viewPortTop - viewPortBottom) * 2 - 1, projectionZPos * 2.0 - 1.0);
        // 变换回世界空间(这里直接执行pv逆变换似乎会导致错误,不知道为啥,难道是我求逆矩阵的逻辑有问题？)
        // 所以先变换会投影空间
        let pw = Matrix44.multiplyMV3(result, Camera.S_TEMP_VEC3, Camera.S_TEMP_MAT4);
        result.multLength(1.0 / pw);
        return result;
    }

}
