<template>
  <div class="apply-permission">
    <el-card class="apply-card">
      <div slot="header" class="apply-card-header">
        <span>申请修改按钮状态</span>
        <el-button size="small" @click="$router.push('/camera')">返回摄像头管理</el-button>
      </div>
      <el-form label-width="90px" size="small">
        <el-form-item label="按钮">
          <!-- popper-append-to-body=false: 下拉面板默认挂到 document.body,
               在 qiankun experimentalStyleIsolation 下样式作用域限定在子应用容器内,
               挂到 body 的面板拿不到样式, 会退化成无定位的裸文本(与 el-dialog 同一类问题) -->
          <el-select v-model="form.buttonKey" placeholder="请选择按钮" :popper-append-to-body="false">
            <el-option label="新增摄像头" value="add" />
            <el-option label="修改摄像头" value="edit" />
            <el-option label="删除摄像头" value="delete" />
            <el-option label="链接生成视频" value="linkVideo" />
            <el-option label="上传视频" value="uploadVideo" />
          </el-select>
        </el-form-item>
        <el-form-item label="申请动作">
          <!-- 只能申请「与当前状态相反」的动作: 已启用的按钮申请启用无意义, 置灰 -->
          <el-radio-group v-model="form.requestAction">
            <el-radio :label="1" :disabled="currentEnabled">申请启用</el-radio>
            <el-radio :label="0" :disabled="!currentEnabled">申请禁用</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="申请理由">
          <el-input v-model="form.reason" type="textarea" :rows="3" placeholder="请填写申请理由" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="small" :loading="submitting" @click="submit">提交申请</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script>
import { submitApplication } from '../api/application';
import { toast } from '../utils/toast';

const LABELS = {
  add: '新增摄像头', edit: '修改摄像头', delete: '删除摄像头',
  linkVideo: '链接生成视频', uploadVideo: '上传视频',
};

export default {
  name: 'ApplyPermission',
  data() {
    return {
      form: { buttonKey: '', requestAction: 1, reason: '' },
      submitting: false,
    };
  },
  computed: {
    // 当前角色所选按钮是否已启用(权限 map 未加载/未选按钮时视为禁用)
    currentEnabled() {
      if (!this.form.buttonKey) return false;
      return this.$store.state.buttons[`admin.${this.form.buttonKey}`] === true;
    },
    // 提交时展示的状态变化: 禁用 -> 启用 / 启用 -> 禁用
    actionText() {
      return this.form.requestAction === 1 ? '禁用 → 启用' : '启用 → 禁用';
    },
  },
  watch: {
    // 切换按钮时, 申请动作自动跟随「与当前状态相反」
    'form.buttonKey'() {
      this.form.requestAction = this.currentEnabled ? 0 : 1;
    },
  },
  methods: {
    async submit() {
      if (!this.form.buttonKey) return toast.warning('请选择按钮');
      this.submitting = true;
      try {
        await submitApplication({
          app: 'admin',
          buttonKey: this.form.buttonKey,
          buttonLabel: LABELS[this.form.buttonKey],
          requestAction: this.form.requestAction,
          reason: this.form.reason,
        });
        toast.success(`申请已提交: 「${LABELS[this.form.buttonKey]}」状态将由 ${this.actionText}, 等待角色菜单审核`);
        this.form = { buttonKey: '', requestAction: 1, reason: '' };
        // 提交成功后返回摄像头管理页(留 1s 让用户看到成功提示; toast 挂在 body 上, 路由跳转不影响其展示)
        setTimeout(() => this.$router.push('/camera'), 1000);
      } catch (e) {
        toast.error(e.message);
      } finally {
        this.submitting = false;
      }
    },
  },
};
</script>

<style scoped lang="less">
// 占满 body, 不再是居中弹窗式卡片
.apply-permission { height: 100%; }
.apply-card {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;

  // 让卡片内容区填满并可滚动
  /deep/ .el-card__body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
  }
}
.apply-card-header { display: flex; align-items: center; justify-content: space-between; }
</style>
