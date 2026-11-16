<template>
  <div class="camera-list">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索摄像头名称" size="small" style="width: 240px"
        @keyup.enter.native="search" clearable @clear="search" />
      <!-- 新增/上传视频按钮按当前角色权限显隐(配置开放才展示, 且服务端二次校验) -->
      <el-button v-if="can('add')" size="small" type="primary" @click="openCreate">新增摄像头</el-button>
      <el-button v-if="can('uploadVideo')" size="small" type="success" @click="openUpload">上传视频</el-button>
      <el-button size="small" @click="fetchList">刷新</el-button>
      <!-- 权限申请入口(原 admin-header 去掉后移到这里, 占位在刷新按钮行右侧) -->
      <el-button size="small" class="apply-btn" @click="goApply">申请权限</el-button>
    </div>

    <!--
      摄像头表格: 使用原生 table 而非 el-table。
      原因: el-table 在本项目(qiankun + Vue 2.7 + experimentalStyleIsolation + 常驻隐藏挂载)
      环境下反复出现"有数据但表头/行完全不渲染、高度塌陷"的问题(分页/按钮均正常, 仅 el-table 异常),
      多次通过 doLayout / ResizeObserver / visibility 切换均无法稳定修复。
      原生 table 无内部布局计算依赖, 可 100% 稳定渲染, 样式对齐 element-ui 视觉。
    -->
    <div class="table-wrap">
      <table class="data-table">
        <colgroup>
          <col style="width: 70px" />
          <col />
          <col />
          <col style="width: 110px" />
          <col style="width: 80px" />
          <col style="width: 300px" />
        </colgroup>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>地址</th>
            <th>地址编号</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in cameras" :key="row.id">
            <td>{{ row.id }}</td>
            <td class="ellipsis" :title="row.cameraName">
              <span class="name-cell">
                <svg class="type-ico" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <title>{{ typeDef(row).label }}</title>
                  <path :d="typeDef(row).path" :fill="typeDef(row).color" />
                </svg>
                <span>{{ row.cameraName }}</span>
              </span>
            </td>
            <td class="ellipsis" :title="row.address">{{ row.address }}</td>
            <td class="ellipsis" :title="row.addressNum">{{ row.addressNum }}</td>
            <td>
              <el-tag :type="Number(row.state) === 1 ? 'success' : 'info'" size="mini">
                {{ Number(row.state) === 1 ? '在线' : '离线' }}
              </el-tag>
            </td>
            <td>
              <!-- 行内操作按当前角色权限显隐 -->
              <el-button v-if="can('edit')" size="mini" @click="openEdit(row)">修改</el-button>
              <el-button v-if="can('linkVideo')" size="mini" @click="openLink(row)">链接视频</el-button>
              <el-button v-if="can('delete')" size="mini" type="danger" @click="remove(row)">删除</el-button>
            </td>
          </tr>
          <tr v-if="!cameras.length">
            <td colspan="6" class="empty-cell">
              {{ loading ? '加载中...' : '暂无数据' }}
            </td>
          </tr>
        </tbody>
      </table>
      <!-- 加载遮罩 -->
      <div v-if="loading" class="table-loading">
        <span class="spinner"></span>
        <span>加载中...</span>
      </div>
    </div>

    <!-- 分页 -->
    <el-pagination class="pager" background layout="prev, pager, next" :total="total"
      :page-size="pageSize" :current-page="page" @current-change="changePage" />

    <!-- 新增/修改弹窗(自建弹窗, 见 ModalBox.vue 顶部注释说明为何不用 el-dialog) -->
    <ModalBox :title="form.id ? '修改摄像头' : '新增摄像头'" :visible="formVisible" width="480px"
      @close="formVisible = false">
      <el-form label-width="90px" size="small">
        <el-form-item label="名称"><el-input v-model="form.cameraName" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="form.address" /></el-form-item>
        <el-form-item label="地址编号"><el-input v-model="form.addressNum" /></el-form-item>
        <el-form-item label="经度"><el-input v-model="form.longitude" /></el-form-item>
        <el-form-item label="纬度"><el-input v-model="form.latitude" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.state">
            <el-radio :label="1">在线</el-radio>
            <el-radio :label="0">离线</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="类别">
          <el-radio-group v-model="form.type">
            <el-radio v-for="t in cameraTypes" :key="t.value" :label="t.value">{{ t.label }}</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="formVisible = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveForm">保存</el-button>
      </template>
    </ModalBox>

    <!-- 链接视频弹窗 -->
    <ModalBox title="链接摄像头生成视频" :visible="linkVisible" width="480px" @close="linkVisible = false">
      <el-form label-width="90px" size="small">
        <el-form-item label="摄像头">{{ linkForm.cameraName }}</el-form-item>
        <el-form-item label="视频地址">
          <el-input v-model="linkForm.videoUrl" placeholder="请输入视频流地址(mp4 / m3u8)" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="linkVisible = false">取消</el-button>
        <el-button size="small" type="primary" @click="saveLink">确认链接</el-button>
      </template>
    </ModalBox>

    <!-- 上传视频弹窗 -->
    <ModalBox title="上传大视频生成离线摄像头" :visible="uploadVisible" width="480px" @close="uploadVisible = false">
      <el-form label-width="90px" size="small">
        <el-form-item label="名称"><el-input v-model="uploadForm.cameraName" /></el-form-item>
        <el-form-item label="地址"><el-input v-model="uploadForm.address" /></el-form-item>
        <el-form-item label="经度"><el-input v-model="uploadForm.longitude" /></el-form-item>
        <el-form-item label="纬度"><el-input v-model="uploadForm.latitude" /></el-form-item>
        <el-form-item label="视频文件">
          <input type="file" accept="video/*" @change="onFileChange" />
        </el-form-item>
        <el-progress v-if="uploading" :percentage="progress" />
      </el-form>
      <template #footer>
        <el-button size="small" @click="uploadVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="uploading" @click="saveUpload">开始上传</el-button>
      </template>
    </ModalBox>

    <!-- 删除确认弹窗(替代 $confirm, 原 MessageBox 挂 body 后样式失效会显示在左下角) -->
    <ModalBox title="提示" :visible="confirmVisible" width="400px" @close="cancelDelete">
      <div class="confirm-body">
        <span class="confirm-icon">!</span>
        <span class="confirm-text">{{ confirmText }}</span>
      </div>
      <template #footer>
        <el-button size="small" @click="cancelDelete">取消</el-button>
        <el-button size="small" type="danger" :loading="deleting" @click="doDelete">确定</el-button>
      </template>
    </ModalBox>
  </div>
</template>

<script>
import { createCamera, updateCamera, deleteCamera, linkVideo, uploadVideo } from '../api/camera';
import { CAMERA_TYPES, cameraTypeOf } from '../utils/cameraType';
import { broadcastCameraMutated } from '../micro';
import { toast } from '../utils/toast';
import ModalBox from '../components/ModalBox.vue';

const emptyForm = () => ({
  id: null, cameraName: '', address: '', addressNum: '', longitude: '', latitude: '', state: 1, type: 1,
});

export default {
  name: 'CameraList',
  components: { ModalBox },
  data() {
    return {
      keyword: '',
      cameraTypes: CAMERA_TYPES,
      formVisible: false,
      linkVisible: false,
      uploadVisible: false,
      uploading: false,
      progress: 0,
      // 删除确认(替代 $confirm)
      confirmVisible: false,
      confirmText: '',
      confirmRow: null,
      deleting: false,
      form: emptyForm(),
      linkForm: { id: null, cameraName: '', videoUrl: '' },
      uploadForm: { cameraName: '', address: '', longitude: '', latitude: '' },
      uploadFile: null,
    };
  },
  computed: {
    cameras() { return this.$store.state.cameras; },
    total() { return this.$store.state.total; },
    page() { return this.$store.state.page; },
    pageSize() { return this.$store.state.pageSize; },
    loading() { return this.$store.state.loading; },
  },
  created() { this.fetchList(); },
  methods: {
    can(key) { return this.$store.getters.can(key); },

    // 摄像头类别定义(名称前的图标)
    typeDef(row) { return cameraTypeOf(row.type); },

    goApply() { this.$router.push('/apply'); },

    search() {
      this.$store.commit('setPage', 1);
      this.$store.commit('setKeyword', this.keyword);
      this.fetchList();
    },
    changePage(p) {
      this.$store.commit('setPage', p);
      this.fetchList();
    },
    fetchList() { this.$store.dispatch('fetchCameras').catch((e) => toast.error(e.message)); },

    openCreate() { this.form = emptyForm(); this.formVisible = true; },
    openEdit(row) {
      this.form = {
        id: row.id, cameraName: row.cameraName, address: row.address, addressNum: row.addressNum,
        longitude: row.longitude, latitude: row.latitude, state: row.state, type: row.type || 1,
      };
      this.formVisible = true;
    },
    async saveForm() {
      try {
        const isEdit = !!this.form.id;
        if (isEdit) await updateCamera(this.form.id, this.form);
        else await createCamera(this.form);
        toast.success('保存成功');
        this.formVisible = false;
        this.fetchList();
        // 通知监控端立即同步(增删改都会影响地图/列表)
        broadcastCameraMutated({ action: isEdit ? 'update' : 'create', id: this.form.id });
      } catch (e) { toast.error(e.message); }
    },

    openLink(row) {
      this.linkForm = { id: row.id, cameraName: row.cameraName, videoUrl: '' };
      this.linkVisible = true;
    },
    /**
     * 保存摄像头视频链接
     * 将视频地址与摄像头ID进行关联，成功后刷新列表
     * @returns {Promise<void>}
     */
    async saveLink() {
      // 验证视频地址必填
      if (!this.linkForm.videoUrl) return toast.warning('请输入视频地址');
      try {
        // 调用接口关联视频链接
        await linkVideo(this.linkForm.id, this.linkForm.videoUrl);
        toast.success('链接成功');
        this.linkVisible = false;
        this.fetchList();
        broadcastCameraMutated({ action: 'link', id: this.linkForm.id });
      } catch (e) { toast.error(e.message); }
    },

    // 删除: 打开自建确认弹窗(不用 $confirm)
    remove(row) {
      this.confirmRow = row;
      this.confirmText = `确认删除摄像头「${row.cameraName}」?`;
      this.confirmVisible = true;
    },
    cancelDelete() {
      this.confirmVisible = false;
      this.confirmRow = null;
    },
    async doDelete() {
      if (!this.confirmRow) return;
      this.deleting = true;
      try {
        await deleteCamera(this.confirmRow.id);
        toast.success('删除成功');
        broadcastCameraMutated({ action: 'delete', id: this.confirmRow.id });
        this.confirmVisible = false;
        this.confirmRow = null;
        this.fetchList();
      } catch (e) {
        toast.error(e.message);
      } finally {
        this.deleting = false;
      }
    },

    openUpload() {
      this.uploadForm = { cameraName: '', address: '', longitude: '', latitude: '' };
      this.uploadFile = null;
      this.progress = 0;
      this.uploadVisible = true;
    },
    onFileChange(e) { this.uploadFile = e.target.files[0]; },
    async saveUpload() {
      if (!this.uploadFile) return toast.warning('请选择视频文件');
      const fd = new FormData();
      fd.append('video', this.uploadFile);
      fd.append('cameraName', this.uploadForm.cameraName);
      fd.append('address', this.uploadForm.address);
      fd.append('longitude', this.uploadForm.longitude);
      fd.append('latitude', this.uploadForm.latitude);
      this.uploading = true;
      try {
        await uploadVideo(fd, (p) => { this.progress = p; });
        toast.success('上传成功, 已生成离线摄像头');
        this.uploadVisible = false;
        this.fetchList();
        broadcastCameraMutated({ action: 'upload' });
      } catch (e) {
        toast.error(e.message);
      } finally {
        this.uploading = false;
      }
    },
  },
};
</script>

<style scoped lang="less">
.camera-list { background: #fff; border-radius: 6px; padding: 16px; }
.toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.toolbar .apply-btn { margin-left: auto; }
.pager { margin-top: 12px; text-align: right; }

// 原生表格, 对齐 element-ui 视觉
.table-wrap {
  position: relative;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  overflow: auto;
}
.data-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
  color: #606266;

  th,
  td {
    padding: 8px 10px;
    text-align: left;
    border-bottom: 1px solid #ebeef5;
    vertical-align: middle;
  }
  th {
    background: #f5f7fa;
    color: #909399;
    font-weight: 600;
    white-space: nowrap;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover { background: #f5f7fa; }

  .ellipsis {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  // 类别图标 + 名称
  .name-cell {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    vertical-align: middle;

    .type-ico { flex-shrink: 0; display: block; }
    span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  }
  .empty-cell {
    text-align: center;
    color: #909399;
    padding: 32px 10px;
  }
}
.table-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.7);
  color: #409eff;
  font-size: 13px;
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #c6e2ff;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: tbl-spin 0.7s linear infinite;
}
@keyframes tbl-spin {
  to { transform: rotate(360deg); }
}

// 删除确认弹窗内容
.confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 8px;
}
.confirm-icon {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  line-height: 20px;
  text-align: center;
  border-radius: 50%;
  background: #fdf6ec;
  color: #e6a23c;
  font-size: 13px;
  font-weight: 700;
}
.confirm-text {
  font-size: 14px;
  line-height: 20px;
  color: #606266;
  word-break: break-all;
}
</style>
