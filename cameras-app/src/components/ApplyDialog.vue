<template>
  <div class="apply-dialog">
    <el-form label-width="90px" size="small">
      <el-form-item label="按钮">
        <el-select v-model="form.buttonKey" placeholder="请选择按钮">
          <el-option label="查看视频" value="viewVideo" />
          <el-option label="链接视频" value="linkVideo" />
        </el-select>
      </el-form-item>
      <el-form-item label="申请动作">
        <el-radio-group v-model="form.requestAction">
          <el-radio :label="1">申请启用</el-radio>
          <el-radio :label="0">申请禁用</el-radio>
        </el-radio-group>
      </el-form-item>
      <el-form-item label="申请理由">
        <el-input v-model="form.reason" type="textarea" :rows="3" placeholder="请填写申请理由" />
      </el-form-item>
    </el-form>
    <div class="footer">
      <el-button size="small" @click="$emit('submitted')">取消</el-button>
      <el-button size="small" type="primary" :loading="submitting" @click="submit">提交申请</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { submitApplication } from '../api/application';
import { toast } from '../utils/toast';

const emit = defineEmits<{ (e: 'submitted'): void }>();

const LABELS: Record<string, string> = { viewVideo: '查看视频', linkVideo: '链接视频' };

const form = reactive({
  buttonKey: 'viewVideo',
  requestAction: 1,
  reason: '',
});
const submitting = ref(false);

async function submit() {
  if (!form.buttonKey) return toast.warning('请选择按钮');
  submitting.value = true;
  try {
    await submitApplication({
      app: 'cameras',
      buttonKey: form.buttonKey,
      buttonLabel: LABELS[form.buttonKey],
      requestAction: form.requestAction,
      reason: form.reason,
    });
    toast.success('申请已提交, 等待角色菜单审核');
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
