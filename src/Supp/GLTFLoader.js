import Node from "../Core/Node/Node.js";
import Tools from "../Core/Util/Tools.js";
import AssetLoader from "../Core/Util/AssetLoader.js";
import Log from "../Core/Util/Log.js";
import Geometry from "../Core/Node/Geometry.js";
import Mesh from "../Core/WebGL/Mesh.js";
import MaterialDef from "../Core/Material/MaterialDef.js";
import Material from "../Core/Material/Material.js";
import Bone from "../Core/Animation/Bone.js";
import SkinGeometry from "../Core/Animation/Skin/SkinGeometry.js";
import AnimationAction from "../Core/Animation/AnimationAction.js";
import TrackMixer from "../Core/Animation/Mixer/TrackMixer.js";
import ActionClip from "../Core/Animation/ActionClip.js";
import TrackBinding from "../Core/Animation/Mixer/TrackBinding.js";
import AnimKeyframeEnum from "../Core/Animation/Keyframe/AnimKeyframeEnum.js";
import Skeleton from "../Core/Animation/Skin/Skeleton.js";
import Joint from "../Core/Animation/Skin/Joint.js";
import AnimationProcessor from "../Core/Animation/AnimationProcessor.js";
import ShaderSource from "../Core/WebGL/ShaderSource.js";
import Vec4Vars from "../Core/WebGL/Vars/Vec4Vars.js";
import FloatVars from "../Core/WebGL/Vars/FloatVars.js";
import Texture2DVars from "../Core/WebGL/Vars/Texture2DVars.js";
import BoolVars from "../Core/WebGL/Vars/BoolVars.js";
import Vector4 from "../Core/Math3d/Vector4.js";
import Matrix44 from "../Core/Math3d/Matrix44.js";
import Internal from "../Core/Render/Internal.js";

/**
 * GLTFLoader。<br/>
 * 提供GLTF模型加载支持,支持二进制glb,gltf+bin,嵌入式gltf。<br/>
 * 参考官方wiki:https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md。<br/>
 * 我实现了很大整个gltf的一个子集，这个子集基本上涵盖了通用的部分内容，但是部分枚举我并没有全部引入。<br/>
 * 有需要请自寻拓展这个加载器或使用第三方加载器。<br/>
 * @author Kkk
 * @date 2021年3月5日13点43分
 */
export default class GLTFLoader {
    static DATA = {5121:Uint8Array, 5123:Uint16Array, 5124:Uint16Array, 5125:Uint32Array, 5126:Float32Array};
    static DATA_COMPONENT = {'SCALAR':1, 'VEC3':3, 'VEC4':4, 'MAT4':16};
    static FILTERS = {
        9729:Texture2DVars.S_FILTERS.S_LINEAR,
        9728:Texture2DVars.S_FILTERS.S_NEAREST,
        9987:Texture2DVars.S_FILTERS.S_LINEAR_MIPMAP_LINEAR,
        9986:Texture2DVars.S_FILTERS.S_NEAREST_MIPMAP_LINEAR,
        9985:Texture2DVars.S_FILTERS.S_LINEAR_MIPMAP_NEAREST,
        9984:Texture2DVars.S_FILTERS.S_NEAREST_MIPMAP_NEAREST
    };
    static WRAPS = {
        10497:Texture2DVars.S_WRAPS.S_REPEAT,
        33071:Texture2DVars.S_WRAPS.S_CLAMP_TO_EDGE
    };
    _m_CustomMatDef = null;
    _m_MatDefSrc = Internal.S_PRINCIPLED_LIGHTING_DEF;
    _m_MagFilter = null;
    _m_MinFilter = null;
    _m_AlphaMode = null;
    config(config){
        this._m_AlphaMode = config.alphaMode || this._m_AlphaMode;
    }

    /**
     * 加载一个GLTF模型。<br/>
     * @param {Scene}[scene]
     * @param {String}[src]
     * @param {Function}[callback]
     * @param {Boolean}[options.batch 对于静态场景,可以设置为true以进行优化数据,对于包含动画场景的模型,静止使用该变量]
     */
    load(scene, src, callback, options){
        this._m_Scene = scene;
        this._m_Batch = options && options.batch;
        this._m_GLTFRootNode = null;
        this._m_PrincipledMatDef = null;
        this._m_DefaultMatDef = null;
        // 缓存已加载纹理
        this._m_Textures = {};
        this._m_Joints = {};
        this._m_Bones = [];
        this._m_Nodes = {};
        this._m_Aps = [];
        this._m_Skeletons = {};
        this._m_AnimationProcessors = {};
        this._m_Mats = {};
        this._m_MatMeshs = {};
        this._m_BasePath = AssetLoader.getBasePath(src);
        this._loadGLTF(src, callback);
    }

    /**
     * 重置加载器。<br/>
     */
    reset(){
        this._m_GLTFRootNode = null;
        this._m_PrincipledMatDef = null;
        this._m_DefaultMatDef = null;
        this._m_Joints = {};
        this._m_Bones = [];
        this._m_Nodes = {};
        this._m_Aps = [];
        this._m_Skeletons = {};
        this._m_AnimationProcessors = {};
        this._m_Mats = {};
        this._m_MatMeshs = {};
    }

    /**
     * 设置Assets路径和自定义材质定义。<br/>
     * @param {String}[assetsPath]
     * @param {String}[customMatDef]
     */
    setAssetsPath(assetsPath, customMatDef){
        this._m_AssetsPath = assetsPath;
        if(customMatDef)
            this._m_CustomMatDef = customMatDef;
    }

    /**
     * 启用指定材质。<br/>
     * @param {String}[matDef]
     */
    useMatDef(matDef){
        this._m_MatDefSrc = matDef;
    }

    /**
     * 强制minFilter,magFilter。<br/>
     * @param {Number}[minFilter GLTFLoader.FILTERS可选值之一]
     * @param {Number}[magFilter GLTFLoader.FILTERS可选值之一]
     */
    compulsoryMinMag(minFilter, magFilter){
        this._m_MinFilter = minFilter;
        this._m_MagFilter = magFilter;
    }

    _loadBIN(gltf, buffers, i, length, ok){
        if(length > 0){
            AssetLoader.loadFile(this._m_BasePath + gltf.buffers[i].uri, (data)=>{
                length--;
                buffers.push({data, byteLength:gltf.buffers[i].byteLength});
                this._loadBIN(gltf, buffers, ++i, length, ok);
            }, null, {inflate:true});
        }
        else{
            // 结束
            if(ok){
                ok();
            }
        }
    }

    /**
     * 加载GLTF。<br/>
     * @param {String}[src]
     * @param {Function}[callback]
     * @private
     */
    _loadGLTF(src, callback){
        AssetLoader.loadFile(src, (gltf)=>{
            gltf = JSON.parse(gltf);
            if(gltf){
                // 开始解析
                // 先把二进制数据载入内存
                // 后续改为根据优先加载策略(比如min,max非常小的可以先不加载对应的bin)
                // 还有就是可以根据需要显示的scene加载对应的bin,只应该在需要对应的bin时才去加载,但目前先全部载入内存
                if(gltf.buffers && gltf.buffers.length > 0){
                    // 假设都是分离式gltf
                    let length = gltf.buffers.length;
                    let i = 0;
                    let buffers = [];
                    this._loadBIN(gltf, buffers, i, length, ()=>{
                        // 所有二进制数据全部加载完成
                        // Log.log("所有二进制加载完成!",buffers);
                        gltf.buffers = buffers;

                        let scene = null;
                        // 开始解析场景
                        if(Tools.checkIsNull(gltf.scene)){
                            scene = this._addScene(gltf);
                        }
                        if(!this._m_Batch){
                            this._bindBone();
                            // 解析动画剪辑
                            if(Tools.checkIsNull(gltf.animations)){
                                this._parseAnimations(gltf);
                                this._m_Aps.forEach(ap=>{
                                    ap.skeleton.finished();
                                });
                            }
                        }
                        else{
                            // 创建batch场景
                            this._batchScene();
                        }


                        Log.log('当前材质:' , this._m_Mats);
                        // 预编译所有材质
                        if(this._m_Mats){
                            for(let matId in this._m_Mats){
                                this._m_Mats[matId].preload();
                            }
                        }
                        if(callback){
                            callback(this._m_GLTFRootNode);
                        }
                    });
                }
            }
            Log.log('gltf:',gltf);
        });
    }
    _batchScene(){
        if(this._m_MatMeshs){
            let mesh = null;
            let geometry = null;
            for(let matId in this._m_MatMeshs){
                mesh = this._m_MatMeshs[matId].mesh;
                geometry = new Geometry(this._m_Scene, {id:matId + "_" + Tools.nextId()});
                geometry.setMesh(mesh);
                geometry.updateBound();
                geometry.setMaterial(this._m_Mats[matId]);
                if(this._m_Mats[matId].renderState){
                    // 暂时先这么简陋实现,后期再封装完整的渲染状态系统
                    if(this._m_Mats[matId].renderState.alphaMode == 'BLEND' || this._m_Mats[matId].renderState.alphaMode == 'MASK'){
                        geometry.setTranslucent();
                    }
                }
                this._m_GLTFRootNode.addChildren(geometry);
            }
        }
    }
    _bindBone(){
        let jis = null;
        let bone = null;
        for(let i = 0;i < this._m_Aps.length;i++){
            jis = this._m_Aps[i].skeleton.getJoints();
            Log.log('jointcount:' + jis.length);
            for(let j = 0;j < jis.length;j++){
                bone = this._m_Nodes[jis[j].getId()];
                // 这里一个潜在性问题是，为了加速解析，这里并非首先遍历所有skin（因为skin并非顺序存储在gltf中）
                // 所以为了避免某些joint引用自node,在这里手动转换为bone
                if(!(bone instanceof Bone) && !bone._update2){
                    bone.getType = function(){
                        return 'Bone';
                    };
                    bone._update2 = bone._updateLocalMatrix;
                    bone.bind = function(b){
                        this._m_Bind = b;
                    };
                    bone.getBind = function(){
                        return this._m_Bind;
                    };
                    bone._updateLocalMatrix = function(){
                        this._update2();
                        if(this._m_Bind){
                            this._m_Bind.actived();
                        }
                    };
                }
                if(bone){
                    jis[j].link(bone);
                }
            }
        }
    }
    _parseAnimations(gltf){
        let trackMixer = null;
        let animationAction = null;
        let actionClip = null;
        let jis = null;
        let t = false;
        gltf.animations.forEach(anim=>{
            animationAction = new AnimationAction(this._getName(anim.name));
            trackMixer = new TrackMixer();
            anim.channels.forEach(channel=>{
                let node = channel.target.node;
                actionClip = new ActionClip(channel.target.path);
                if(this._m_Nodes[node]){
                    // 创建轨迹
                    TrackBinding.createTrack(actionClip, this._m_Nodes[node]);
                    // 采样轨迹
                    let sampler = anim.samplers[channel.sampler];
                    this._parseSampler(gltf, sampler.input, sampler.output, sampler.interpolation, AnimKeyframeEnum.S_KEY_FRAME[channel.target.path], actionClip);
                    trackMixer.addClip(actionClip);

                    t = false;
                    for(let i = 0;i < this._m_Aps.length;i++){
                        jis = this._m_Aps[i].skeleton.getJoints();
                        for(let j = 0;j < jis.length;j++){
                            if(jis[j].getId() == node){
                                t = true;
                                // jis[j].link(this._m_Nodes[node]);
                                this._m_Aps[i].animationProcessor.addAnimationAction(animationAction);
                                break;
                            }
                        }
                        if(t){
                            break;
                        }
                    }
                    if(!t){
                        // 非skin动画
                        Log.log(node + '非skin动画!path:' + channel.target.path);
                        let animationProcessor = null;
                        if(!this._m_AnimationProcessors[node]){
                            let animationProcessor = new AnimationProcessor(this._m_GLTFRootNode, {id:Tools.nextId() + "_" + node + "_animationProcessor"});
                            this._m_AnimationProcessors[node] = animationProcessor;
                        }
                        animationProcessor = this._m_AnimationProcessors[node];
                        animationProcessor.addAnimationAction(animationAction);
                    }
                    // this._m_Aps[0].animationProcessor.addAnimationAction(animationAction);
                }
                else{
                    Log.log('animation_node:' + node);
                }
            });
            animationAction.setTrackMixer(trackMixer);
        });
    }
    _getAccessorData(gltf, i){
        let _accessors = gltf.accessors[i];
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_accessors.bufferView];
        let dataCount = GLTFLoader.DATA_COMPONENT[_accessors.type];
        return new GLTFLoader.DATA[_accessors.componentType](_buffers[_bufferView.buffer].data, (_bufferView.byteOffset || 0) + (_accessors.byteOffset || 0), _accessors.count * dataCount);
    }
    _parseSampler(gltf, i, o, ip, keyframe, actionClip){
        let _i = this._getAccessorData(gltf, i);
        let _o = this._getAccessorData(gltf, o);
        let clipCount = gltf.accessors[i].count;
        let dataCount = GLTFLoader.DATA_COMPONENT[gltf.accessors[o].type];
        let _keyframe = null;
        let offset = 0;
        for(let i = 0;i < clipCount;i++){
            offset = i * dataCount;
            if(dataCount > 3){
                if(!keyframe){
                    Log.warn("未知keyframe!");
                }
                _keyframe = new keyframe(_i[i], _o[offset], _o[offset + 1], _o[offset + 2], _o[offset + 3]);
                // Log.log('_keyframe,time:' + _keyframe.getTime() + ',value:' + _keyframe.getValue().toString());
            }
            else{
                if(!keyframe){
                    Log.warn("未知keyframe!");
                }
                _keyframe = new keyframe(_i[i], _o[offset], _o[offset + 1], _o[offset + 2]);
            }
            _keyframe.setInterpolationMode(ip);
            actionClip.addKeyframe(_keyframe);
        }
    }
    _addScene(gltf){
        if(Tools.checkIsNull(gltf.scene)){
            let _scene = gltf.scenes[gltf.scene];
            let sceneNode = new Node(this._m_Scene, {id:_scene.name});
            if(this._m_Batch){
                // 因为batchScene已经执行了合并变换操作,所以在这里消除
                this._m_GLTFRootNode = new Node(this._m_Scene, {id:Tools.nextId() + "_scene"});
                this._m_GLTFRootNode.addChildren(sceneNode);
            }
            else{
                this._m_GLTFRootNode = sceneNode;
            }
            // 检查子节点
            if(Tools.checkIsNull(_scene.nodes)){
                // 添加子节点
                _scene.nodes.forEach(node=>{
                    this._addNode(gltf, sceneNode, node);
                });
            }
            return this._m_GLTFRootNode;
        }
        return null;
    }
    _getName(name){
        if(name == null || name == undefined || name == ''){
            return Tools.nextId();
        }
        return name;
    }
    _parseSkins(gltf, i){
        let skin = gltf.skins[i];
        let skeleton = new Skeleton(this._getName(skin.name));
        let skeletonJoint = null;
        let jointSpaceData = this._getAccessorData(gltf, skin.inverseBindMatrices);
        let ji = 0;
        let array = [];
        skin.joints.forEach(joint=>{
            this._m_Joints[joint] = true;
            array.length = 0;
            for(let i = 0, offset = ji * 16;i < 16;i++){
                array.push(jointSpaceData[i + offset]);
            }
            skeletonJoint = new Joint(joint, ji);
            skeletonJoint.setJointSpace(array);
            skeleton.addJoint(skeletonJoint);
            ji++;
        });
        return skeleton;
    }
    _addNode(gltf, parent, nodeI){
        // Log.log('nodeI:' + nodeI + ";name:" + gltf.nodes[nodeI].name);
        let _node = gltf.nodes[nodeI];
        let node = null;
        // 创建Node
        if(this._m_Joints[nodeI]){
            node = new Bone(parent, {id:this._getName(_node.name)});
            this._m_Bones.push(node);
            // Log.log('添加Bone' + nodeI);
        }
        else{
            node = new Node(parent, {id:this._getName(_node.name)});
        }
        this._m_Nodes[nodeI] = node;
        parent.addChildren(node);
        if(Tools.checkIsNull(_node.children)){
            // 解析子节点
            _node.children.forEach(nodeI=>{
                this._addNode(gltf, node, nodeI);
            });
        }
        if(node){
            // 变换
            if(Tools.checkIsNull(_node.scale)){
                node.setLocalScaleXYZ(_node.scale[0], _node.scale[1], _node.scale[2]);
            }
            if(Tools.checkIsNull(_node.rotation)){
                node.setLocalRotationFromXYZW(_node.rotation[0], _node.rotation[1], _node.rotation[2], _node.rotation[3]);
            }
            if(Tools.checkIsNull(_node.translation)){
                node.setLocalTranslationXYZ(_node.translation[0], _node.translation[1], _node.translation[2]);
            }
            if(Tools.checkIsNull(_node.matrix)){
                node.setLocalMatrixFromArray(_node.matrix);
            }
        }
        // 解析mesh结构
        if(Tools.checkIsNull(_node.mesh)){
            if(this._m_Batch){
                // batch将一致处理，所以这里会忽略导致动画数据被过滤掉
                this._parseMeshBatch(gltf, node, _node.mesh);
            }
            else{
                this._parseMesh(gltf, node, _node.mesh, Tools.checkIsNull(_node.skin));
                if(Tools.checkIsNull(_node.skin)){
                    // 添加骨架
                    // 如果已经存在skin则直接应用这套骨架
                    let skeleton = null;
                    if(this._m_Skeletons[_node.skin]){
                        skeleton = this._m_Skeletons[_node.skin];
                    }
                    else{
                        skeleton = this._parseSkins(gltf, _node.skin);
                        this._m_Skeletons[_node.skin] = skeleton;
                        Log.log('创建Skeleton!');
                    }
                    node.getChildren().forEach(skinGeometryNode=>{
                        skinGeometryNode.setSkeleton(skeleton);
                    });
                    // 添加AnimationProcessor
                    if(this._m_AnimationProcessors[_node.skin]){
                        // 说明该ap被多个skin引用,应该将其附加到这些skin的父类
                    }
                    else{
                        // 这里将所有animationProcessor附加到根节点中,而不再附加到最近层级,虽然没有了层级描述性,但方便了使用和管理
                        let animationProcessor = new AnimationProcessor(this._m_GLTFRootNode, {id:Tools.nextId() + "_animationProcessor"});
                        this._m_Aps.push({skeleton, animationProcessor});
                        this._m_AnimationProcessors[_node.skin] = animationProcessor;
                    }
                }
            }
        }
    }
    _transformVertex(inPosition, inMat4){
        let inVec4 = new Vector4();
        let outVec4 = new Vector4();
        let outPositions = [];
        for(let i = 0;i < inPosition.length;i+=3){
            inVec4.setToInXYZW(inPosition[i], inPosition[i + 1], inPosition[i + 2], 1.0);
            Matrix44.multiplyMV(outVec4, inVec4, inMat4);
            outPositions.push(outVec4._m_X);
            outPositions.push(outVec4._m_Y);
            outPositions.push(outVec4._m_Z);
        }
        return outPositions;
    }
    _transformNormal(inPosition, inMat4){
        let normalMatrix = new Matrix44();
        normalMatrix.set(inMat4);
        normalMatrix.inert();
        normalMatrix.transpose();
        let inVec4 = new Vector4();
        let outVec4 = new Vector4();
        let outPositions = [];
        for(let i = 0;i < inPosition.length;i+=3){
            inVec4.setToInXYZW(inPosition[i], inPosition[i + 1], inPosition[i + 2], 0.0);
            Matrix44.multiplyMV(outVec4, inVec4, inMat4);
            outPositions.push(outVec4._m_X);
            outPositions.push(outVec4._m_Y);
            outPositions.push(outVec4._m_Z);
        }
        return outPositions;
    }
    _parseMeshBatch(gltf, parrent, meshI){
        let _mesh = gltf.meshes[meshI];
        let _primitives = _mesh.primitives;
        let _primitive = null;
        let geometryNode = null;
        let mesh = null;
        for(let i = 0;i < _primitives.length;i++){
            _primitive = _primitives[i];
            let matId = null;
            if(Tools.checkIsNull(_primitive.material)){
                // 后续完善时,这里单独到一个函数中进行,因为解析PBR材质参数最好独立到一个解析函数中

                if(!this._m_PrincipledMatDef){
                    if(this._m_AssetsPath && this._m_CustomMatDef){
                        this._m_PrincipledMatDef = MaterialDef.load(this._m_AssetsPath + this._m_CustomMatDef);
                    }
                    else{
                        this._m_PrincipledMatDef = MaterialDef.parse(this._m_MatDefSrc);
                    }
                }
                matId = this._getName(gltf.materials[_primitive.material].name);
                let material = null;
                if(this._m_Mats[matId]){
                    material = this._m_Mats[matId];
                }
                else{
                    material = new Material(this._m_Scene, {id:matId, materialDef:this._m_PrincipledMatDef});
                    this._parseMaterial(gltf, _primitive.material, material);
                    this._m_Mats[matId] = material;
                }
            }
            else{
                // 添加一个默认材质
                if(!this._m_DefaultMatDef){
                    if(this._m_AssetsPath){
                        // this._m_DefaultMatDef = MaterialDef.load(this._m_AssetsPath + "HeightFieldDef");
                        this._m_DefaultMatDef = MaterialDef.parse(Internal.S_COLOR_DEF_DATA);
                    }
                    else{
                        this._m_DefaultMatDef = MaterialDef.parse(this._m_MatDefSrc);
                    }
                }
                matId = 'default_gltf_mat';
                let material = null;
                if(this._m_Mats[matId]){
                    material = this._m_Mats[matId];
                }
                else{
                    // 创建新材质,后续移到独立方法创建适配的pbr材质或转换phong材质
                    material = new Material(this._m_Scene, {id:matId, materialDef:this._m_DefaultMatDef});
                    this._m_Mats[matId] = material;
                }
            }
            if(!this._m_MatMeshs[matId]){
                // 解析mesh
                mesh = new Mesh();
                // 首先是几何属性
                if(Tools.checkIsNull(_primitive.attributes.POSITION)){
                    // position属性
                    let positions = this._parsePositions(gltf, _primitive.attributes.POSITION);
                    if(parrent){
                        positions.data = this._transformVertex(positions.data, parrent.getWorldMatrix());
                    }
                    mesh.setData(Mesh.S_POSITIONS, positions.data);
                }
                if(Tools.checkIsNull(_primitive.attributes.NORMAL)){
                    // normal属性
                    let normals = this._parseNormals(gltf, _primitive.attributes.NORMAL);
                    if(parrent){
                        normals.data = this._transformNormal(normals.data, parrent.getWorldMatrix());
                    }
                    mesh.setData(Mesh.S_NORMALS, normals.data);
                }
                if(Tools.checkIsNull(_primitive.attributes.TEXCOORD_0)){
                    // 第一道texCoord属性(暂时跳过lightMap)
                    let texcoords = this._parseTexcoords(gltf, _primitive.attributes.TEXCOORD_0);
                    let t = [];
                    for(let i = 0;i < texcoords.data.length;i++){
                        t.push(texcoords.data[i]);
                    }
                    mesh.setData(Mesh.S_UV0, t);
                }
                // 其次是索引
                if(Tools.checkIsNull(_primitive.indices)){
                    // indices数据
                    let indices = this._parseIndices(gltf, _primitive.indices);
                    // 因为ArrayBuffer不存在push方法,所以这里转换为array
                    let t = [];
                    for(let i = 0;i < indices.data.length;i++){
                        t.push(indices.data[i]);
                    }
                    mesh.setData(indices.bufType == 5125 ? Mesh.S_INDICES_32 : Mesh.S_INDICES, t);
                }
                if(Tools.checkIsNull(_primitive.attributes.TANGENT)){
                    // normal属性
                    let tangents = this._parseTangents(gltf, _primitive.attributes.TANGENT);
                    let t = [];
                    for(let i = 0;i < tangents.data.length;i++){
                        t.push(tangents.data[i]);
                    }
                    mesh.setData(Mesh.S_TANGENTS, t);
                }
                else{
                    // 生成切线数据
                    if(mesh.getData(Mesh.S_UV0)){
                        let tangents = Tools.generatorTangents2(mesh.getData(Mesh.S_INDICES) ? mesh.getData(Mesh.S_INDICES) : mesh.getData(Mesh.S_INDICES_32), mesh.getData(Mesh.S_POSITIONS), mesh.getData(Mesh.S_UV0), mesh.getData(Mesh.S_NORMALS));
                        let t = [];
                        for(let i = 0;i < tangents.length;i++){
                            t.push(tangents[i]);
                        }
                        mesh.setData(Mesh.S_TANGENTS, t);
                    }
                    else{
                        // 为了内存对齐
                        let tangents = Tools.generatorFillTangents2(mesh.getData(Mesh.S_INDICES) ? mesh.getData(Mesh.S_INDICES) : mesh.getData(Mesh.S_INDICES_32), mesh.getData(Mesh.S_POSITIONS), mesh.getData(Mesh.S_UV0));
                        for(let i = 0;i < tangents.length;i++){
                            t.push(tangents[i]);
                        }
                        mesh.setData(Mesh.S_TANGENTS, t);
                    }
                }
                this._m_MatMeshs[matId] = {mesh};
            }
            else{
                mesh = this._m_MatMeshs[matId].mesh;
                let meshPositionsLength = 0;
                // 首先是几何属性
                if(Tools.checkIsNull(_primitive.attributes.POSITION)){
                    // position属性
                    let positions = this._parsePositions(gltf, _primitive.attributes.POSITION);
                    if(parrent){
                        positions.data = this._transformVertex(positions.data, parrent.getWorldMatrix());
                    }
                    let meshPositions = mesh.getData(Mesh.S_POSITIONS);
                    if(meshPositions){
                        meshPositionsLength = meshPositions.length;
                        positions.data.forEach(pos=>{
                            meshPositions.push(pos);
                        });
                        mesh.setData(Mesh.S_POSITIONS, meshPositions);
                    }
                }
                if(Tools.checkIsNull(_primitive.attributes.NORMAL)){
                    // normal属性
                    let normals = this._parseNormals(gltf, _primitive.attributes.NORMAL);
                    if(parrent){
                        normals.data = this._transformNormal(normals.data, parrent.getWorldMatrix());
                    }
                    let meshNormals = mesh.getData(Mesh.S_NORMALS);
                    if(meshNormals){
                        normals.data.forEach(nor=>{
                            meshNormals.push(nor);
                        });
                        mesh.setData(Mesh.S_NORMALS, meshNormals);
                    }
                }
                if(Tools.checkIsNull(_primitive.attributes.TEXCOORD_0)){
                    // 第一道texCoord属性(暂时跳过lightMap)
                    let texcoords = this._parseTexcoords(gltf, _primitive.attributes.TEXCOORD_0);
                    let meshTexCoords = mesh.getData(Mesh.S_UV0);
                    if(meshTexCoords){
                        texcoords.data.forEach(tex=>{
                            meshTexCoords.push(tex);
                        });
                        mesh.setData(Mesh.S_UV0, meshTexCoords);
                    }
                }
                // 其次是索引
                if(Tools.checkIsNull(_primitive.indices)){
                    // indices数据
                    let indices = this._parseIndices(gltf, _primitive.indices);
                    let meshIndices = mesh.getData(Mesh.S_INDICES);
                    let offset = 0;
                    if(meshIndices){
                        offset = meshPositionsLength / 3;
                        indices.data.forEach(ind=>{
                            meshIndices.push(ind + offset);
                        });
                        mesh.setData(indices.bufType == 5125 ? Mesh.S_INDICES_32 : Mesh.S_INDICES, meshIndices);
                        if(indices.bufType != 5125){
                            mesh.setData(Mesh.S_INDICES, null);
                        }
                    }
                    else{
                        meshIndices = mesh.getData(Mesh.S_INDICES_32);
                        if(meshIndices){
                            offset = meshPositionsLength / 3;
                            indices.data.forEach(ind=>{
                                meshIndices.push(ind + offset);
                            });
                            mesh.setData(Mesh.S_INDICES_32, meshIndices);
                        }
                    }
                }
                if(Tools.checkIsNull(_primitive.attributes.TANGENT)){
                    // normal属性
                    let tangents = this._parseTangents(gltf, _primitive.attributes.TANGENT);
                    let meshTangents = mesh.getData(Mesh.S_TANGENTS);
                    if(meshTangents){
                        tangents.data.forEach(tan=>{
                            meshTangents.push(tan);
                        });
                        mesh.setData(Mesh.S_TANGENTS, meshTangents);
                    }
                }
                else{
                    // 生成切线数据
                    if(mesh.getData(Mesh.S_UV0)){
                        let tangents = Tools.generatorTangents(mesh.getData(Mesh.S_INDICES) ? mesh.getData(Mesh.S_INDICES) : mesh.getData(Mesh.S_INDICES_32), mesh.getData(Mesh.S_POSITIONS), mesh.getData(Mesh.S_UV0));
                        let meshTangents = mesh.getData(Mesh.S_TANGENTS);
                        if(meshTangents){
                            tangents.forEach(tan=>{
                                meshTangents.push(tan);
                            });
                            mesh.setData(Mesh.S_TANGENTS, meshTangents);
                        }
                    }
                    else{
                        // 为了内存对齐
                        let tangents = Tools.generatorFillTangents(mesh.getData(Mesh.S_INDICES) ? mesh.getData(Mesh.S_INDICES) : mesh.getData(Mesh.S_INDICES_32), mesh.getData(Mesh.S_POSITIONS), mesh.getData(Mesh.S_UV0));
                        let meshTangents = mesh.getData(Mesh.S_TANGENTS);
                        if(meshTangents){
                            tangents.forEach(tan=>{
                                meshTangents.push(tan);
                            });
                            mesh.setData(Mesh.S_TANGENTS, meshTangents);
                        }
                    }
                }
            }
        }
    }
    _parseMesh(gltf, parrent, meshI, isSkin){
        let _mesh = gltf.meshes[meshI];
        let _primitives = _mesh.primitives;
        let _primitive = null;
        let geometryNode = null;
        let mesh = null;
        for(let i = 0;i < _primitives.length;i++){
            _primitive = _primitives[i];
            if(isSkin){
                geometryNode = new SkinGeometry(parrent, {id:this._getName(_mesh.name) + i});
            }
            else{
                geometryNode = new Geometry(parrent, {id:this._getName(_mesh.name) + i});
            }
            parrent.addChildren(geometryNode);
            // 解析mesh
            mesh = new Mesh();
            // 首先是几何属性
            if(Tools.checkIsNull(_primitive.attributes.POSITION)){
                // position属性
                let positions = this._parsePositions(gltf, _primitive.attributes.POSITION);
                mesh.setData(Mesh.S_POSITIONS, positions.data);
            }
            if(Tools.checkIsNull(_primitive.attributes.NORMAL)){
                // normal属性
                let normals = this._parseNormals(gltf, _primitive.attributes.NORMAL);
                mesh.setData(Mesh.S_NORMALS, normals.data);
            }
            if(Tools.checkIsNull(_primitive.attributes.TEXCOORD_0)){
                // 第一道texCoord属性(暂时跳过lightMap)
                let texcoords = this._parseTexcoords(gltf, _primitive.attributes.TEXCOORD_0);
                mesh.setData(Mesh.S_UV0, texcoords.data);
            }

            // skin部分
            if(isSkin){
                if(Tools.checkIsNull(_primitive.attributes.JOINTS_0)){
                    let joints_0 = this._parseJoints(gltf, _primitive.attributes.JOINTS_0);
                    mesh.setData(joints_0.bufType == 5125 ? Mesh.S_JOINTS_0_32 : Mesh.S_JOINTS_0, joints_0.data);
                }
                if(Tools.checkIsNull(_primitive.attributes.WEIGHTS_0)){
                    let weights_0 = this._parseWeights(gltf, _primitive.attributes.WEIGHTS_0);
                    mesh.setData(Mesh.S_WEIGHTS_0, weights_0.data);
                }
            }

            // 其次是索引
            if(Tools.checkIsNull(_primitive.indices)){
                // indices数据
                let indices = this._parseIndices(gltf, _primitive.indices);
                mesh.setData(indices.bufType == 5125 ? Mesh.S_INDICES_32 : Mesh.S_INDICES, indices.data);
            }
            if(Tools.checkIsNull(_primitive.attributes.TANGENT)){
                // normal属性
                let tangents = this._parseTangents(gltf, _primitive.attributes.TANGENT);
                mesh.setData(Mesh.S_TANGENTS, tangents.data);
            }
            else{
                // 生成切线数据
                if(mesh.getData(Mesh.S_UV0)){
                    console.log('生成切线数据');
                    let tangents = Tools.generatorTangents2(mesh.getData(Mesh.S_INDICES) ? mesh.getData(Mesh.S_INDICES) : mesh.getData(Mesh.S_INDICES_32), mesh.getData(Mesh.S_POSITIONS), mesh.getData(Mesh.S_UV0), mesh.getData(Mesh.S_NORMALS));
                    mesh.setData(Mesh.S_TANGENTS, tangents);
                }
                else{
                    console.log('-----------------------------');
                }
            }
            // 然后是材质(这里先跳过PBR材质)
            if(Tools.checkIsNull(_primitive.material)){
                // 后续完善时,这里单独到一个函数中进行,因为解析PBR材质参数最好独立到一个解析函数中

                if(!this._m_PrincipledMatDef){
                    if(this._m_AssetsPath){
                        // this._m_PrincipledMatDef = MaterialDef.load(this._m_AssetsPath + "PrincipledLightingDef");
                        this._m_PrincipledMatDef = MaterialDef.parse(this._m_MatDefSrc);
                    }
                    else{
                        this._m_PrincipledMatDef = MaterialDef.parse(this._m_MatDefSrc);
                    }
                }
                let matId = this._getName(gltf.materials[_primitive.material].name);
                let material = null;
                if(this._m_Mats[matId]){
                    material = this._m_Mats[matId];
                }
                else{
                    material = new Material(this._m_Scene, {id:matId, materialDef:this._m_PrincipledMatDef});
                    this._parseMaterial(gltf, _primitive.material, material);
                    this._m_Mats[matId] = material;
                }
                geometryNode.setMaterial(material);
                if(material.renderState){
                    // 暂时先这么简陋实现,后期再封装完整的渲染状态系统
                    if(material.renderState.alphaMode == 'BLEND' || material.renderState.alphaMode == 'MASK'){
                        geometryNode.setTranslucent();
                    }
                }
            }
            else{
                // 添加一个默认材质
                if(!this._m_DefaultMatDef){
                    // this._m_DefaultMatDef = MaterialDef.load(this._m_AssetsPath + "HeightFieldDef");
                    this._m_DefaultMatDef = MaterialDef.parse(Internal.S_COLOR_DEF_DATA);
                }
                let matId = 'default_gltf_mat';
                let material = null;
                if(this._m_Mats[matId]){
                    material = this._m_Mats[matId];
                }
                else{
                    // 创建新材质,后续移到独立方法创建适配的pbr材质或转换phong材质
                    material = new Material(this._m_Scene, {id:matId, materialDef:this._m_DefaultMatDef});
                    this._m_Mats[matId] = material;
                }
                geometryNode.setMaterial(material);
            }
            geometryNode.setMesh(mesh);
            geometryNode.updateBound();
            // 如果是skinGeometry,则添加skin数据
            if(isSkin){
                geometryNode.getMaterial().addDefine(ShaderSource.S_SKINS_SRC);
                // Log.log("重新编译:" , geometryNode.getMaterial());
            }
        }
    }
    _samplerMap(gltf, i, srgb){
        let map = gltf.textures[i];
        let img = gltf.images[map.source];
        if(this._m_Textures[img.uri]){
            return this._m_Textures[img.uri];
        }
        let texture = new Texture2DVars(this._m_Scene);
        if(srgb)
            texture.setTextureFormat(Texture2DVars.S_TEXTURE_FORMAT.S_SRGBA, Texture2DVars.S_TEXTURE_FORMAT.S_RGBA, Texture2DVars.S_TEXTURE_FORMAT.S_UNSIGNED_BYTE);
        texture.setImageSrc(this._m_Scene, this._m_BasePath + img.uri);
        if(Tools.checkIsNull(map.sampler)){
            let sampler = gltf.samplers[map.sampler];
            // 设置纹理采样参数
            if(Tools.checkIsNull(sampler)){
                if(this._m_MinFilter != null && this._m_MagFilter != null){
                    texture.setFilter(this._m_Scene, this._m_MinFilter, this._m_MagFilter);
                }
                else{
                    let magFilter = sampler.magFilter;
                    let minFilter = sampler.minFilter;
                    if(magFilter && minFilter){
                        texture.setFilter(this._m_Scene, GLTFLoader.FILTERS[minFilter], GLTFLoader.FILTERS[magFilter]);
                    }
                }
                let wrapS = sampler.wrapS;
                let wrapT = sampler.wrapT;
                if(wrapS && wrapT){
                    texture.setWrap(this._m_Scene, GLTFLoader.WRAPS[wrapS], GLTFLoader.WRAPS[wrapT]);
                }
            }
        }
        this._m_Textures[img.uri] = texture;
        return texture;
    }
    _parseMaterial(gltf, i, material){
        let _material = gltf.materials[i];
        // metallic管道
        if(_material['pbrMetallicRoughness']){
            let pbrMetallicRoughness = _material['pbrMetallicRoughness'];
            let baseColorFactor = pbrMetallicRoughness.baseColorFactor;
            if(Tools.checkIsNull(baseColorFactor)){
                material.setParam('baseColor', new Vec4Vars().valueFromXYZW(baseColorFactor[0], baseColorFactor[1], baseColorFactor[2], baseColorFactor[3]));
            }
            let roughnessFactor = pbrMetallicRoughness.roughnessFactor;
            if(Tools.checkIsNull(roughnessFactor)){
                material.setParam('roughness', new FloatVars().valueOf(roughnessFactor));
            }
            let metallicFactor = pbrMetallicRoughness.metallicFactor;
            if(Tools.checkIsNull(metallicFactor)){
                material.setParam('metallic', new FloatVars().valueOf(metallicFactor));
            }
            let baseColorTexture = pbrMetallicRoughness.baseColorTexture;
            if(Tools.checkIsNull(baseColorTexture)){
                material.setParam('baseColorMap', this._samplerMap(gltf, baseColorTexture.index, true));
            }
            let metallicRoughnessTexture = pbrMetallicRoughness.metallicRoughnessTexture;
            if(Tools.checkIsNull(metallicRoughnessTexture)){
                material.setParam('metallicRoughnessMap', this._samplerMap(gltf, metallicRoughnessTexture.index));
            }
        }
        // specular管道
        if(_material.extensions && _material.extensions['KHR_materials_pbrSpecularGlossiness']){
            let KHR_materials_pbrSpecularGlossiness = _material.extensions["KHR_materials_pbrSpecularGlossiness"];
            material.setParam('useSpecGloss', new BoolVars().valueOf(true));
            let diffuseTexture = KHR_materials_pbrSpecularGlossiness.diffuseTexture;
            if(Tools.checkIsNull(diffuseTexture)){
                material.setParam('baseColorMap', this._samplerMap(gltf, diffuseTexture.index, true));
            }
            let specularGlossinessTexture = KHR_materials_pbrSpecularGlossiness.specularGlossinessTexture;
            if(Tools.checkIsNull(specularGlossinessTexture)){
                material.setParam('specularGlossinessMap', this._samplerMap(gltf, specularGlossinessTexture.index, true));
            }
        }
        let normalTexture = _material.normalTexture;
        if(Tools.checkIsNull(normalTexture)){
            // 可能还需要解析scale
            material.setParam('normalMap', this._samplerMap(gltf, normalTexture.index));
        }
        let occlusionTexture = _material.occlusionTexture;
        if(Tools.checkIsNull(occlusionTexture)){
            let texCoord = occlusionTexture.texCoord;
            material.setParam('lightMap', this._samplerMap(gltf, occlusionTexture.index, true));
            if(texCoord != null && texCoord != 0){
                // 激活独立通道纹理
            }
            else{
                material.setParam('aoMap', new BoolVars().valueOf(true));
            }
        }
        let emissiveFactor = _material.emissiveFactor;
        if(Tools.checkIsNull(emissiveFactor)){
            material.setParam('emissive', new Vec4Vars().valueFromXYZW(emissiveFactor[0], emissiveFactor[1], emissiveFactor[2], 1.0));
        }
        let emissiveTexture = _material.emissiveTexture;
        if(Tools.checkIsNull(emissiveTexture)){
            material.setParam('emissiveMap', this._samplerMap(gltf, emissiveTexture.index, true));
        }
        let renderState = {};
        if(_material.alphaMode){
            if(this._m_AlphaMode == 'discard'){
                material.setParam('alphaDiscard', new FloatVars().valueOf(0.1));
            }
            else{
                renderState.alphaMode = _material.alphaMode;
            }
        }
        if(_material.doubleSided){
            renderState.doubleSided = _material.doubleSided;
        }
        material.renderState = renderState;
    }
    _parsePositions(gltf, i){
        let _positionsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_positionsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let positions = new GLTFLoader.DATA[_positionsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_positionsAccessors.byteOffset || 0), _positionsAccessors.count * 3);
        return {data:positions, bufType:_positionsAccessors.componentType};
    }
    _parseTangents(gltf, i){
        let _tangentsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_tangentsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let tangents = new GLTFLoader.DATA[_tangentsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_tangentsAccessors.byteOffset || 0), _tangentsAccessors.count * 4);
        return {data:tangents, bufType:_tangentsAccessors.componentType};
    }
    _parseNormals(gltf, i){
        let _normalsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_normalsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let normals = new GLTFLoader.DATA[_normalsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_normalsAccessors.byteOffset || 0), _normalsAccessors.count * 3);
        return {data:normals, bufType:_normalsAccessors.componentType};
    }
    _parseTexcoords(gltf, i){
        let _texcoordsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_texcoordsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let texcoords = new GLTFLoader.DATA[_texcoordsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_texcoordsAccessors.byteOffset || 0), _texcoordsAccessors.count * 2);
        return {data:texcoords, bufType:_texcoordsAccessors.componentType};
    }
    _parseIndices(gltf, i){
        let _indicessAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_indicessAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let indices = new GLTFLoader.DATA[_indicessAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_indicessAccessors.byteOffset || 0), _indicessAccessors.count);
        return {data:indices, bufType:_indicessAccessors.componentType};
    }
    _parseJoints(gltf, i){
        let _jointsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_jointsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let joints = new GLTFLoader.DATA[_jointsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_jointsAccessors.byteOffset || 0), _jointsAccessors.count * 4);
        return {data:joints, bufType:_jointsAccessors.componentType};
    }
    _parseWeights(gltf, i){
        let _weightsAccessors = gltf.accessors[i];
        // 解析
        let _buffers = gltf.buffers;
        let _bufferView = gltf.bufferViews[_weightsAccessors.bufferView];
        let _buffer = _buffers[_bufferView.buffer].data;
        // 后续应该统一缓存,而不是每次newFloat32Array
        // 然后通过accessors.byteOffset和count来截取
        let weights = new GLTFLoader.DATA[_weightsAccessors.componentType](_buffer, (_bufferView.byteOffset || 0) + (_weightsAccessors.byteOffset || 0), _weightsAccessors.count * 4);
        return {data:weights, bufType:_weightsAccessors.componentType};
    }
}
