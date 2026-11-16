<template>
  <div class="apply-dialog">
    <el-form label-width="90px" size="small">
      <el-form-item label="按钮">
        <el-select v-model="form.buttonKey" placeholder="请选择按钮">
          <el-option v-for="opt in OPTIONS" :key="opt.key" :label="opt.label" :value="opt.key" />
        </el-select>
      </el-form-item>
      <el-form-item label="申请动作">
        <!-- 只能申请「与当前状态相反」的动作: 已启用的按钮申请启用无意义, 置灰 -->
        <el-radio-group v-model="form.requestAction">
          <el-radio :label="1" :disabled="isEnabled(form.buttonKey)">申请启用</el-radio>
          <el-radio :label="0" :disabled="!isEnabled(form.buttonKey)">申请禁用</el-radio>
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
import { computed, reactive, ref, watch } from 'vue';
import { submitApplication } from '../api/application';
import { useButtonStore } from '../store/button';
import { toast } from '../utils/toast';

const emit = defineEmits<{ (e: 'submitted'): void }>();

const OPTIONS = [
  { key: 'viewVideo', label: '查看视频' },
  { key: 'linkVideo', label: '链接视频' },
  { key: 'uploadVideo', label: '上传视频' },
  { key: 'changeState', label: '修改状态' },
];
const LABELS = Object.fromEntries(OPTIONS.map((o) => [o.key, o.label]));

const buttonStore = useButtonStore();
const form = reactive({
  buttonKey: 'viewVideo',
  requestAction: 1,
  reason: '',
});
const submitting = ref(false);

// 当前角色该按钮是否已启用(权限 map 未加载时视为禁用, 兜底允许申请启用)
function isEnabled(key: string) {
  return buttonStore.buttons[`cameras.${key}`] === true;
}
// 提交时展示的状态变化: 禁用 -> 启用 / 启用 -> 禁用
const actionText = computed(() => (form.requestAction === 1 ? '禁用 → 启用' : '启用 → 禁用'));

// 切换按钮时, 申请动作自动跟随「与当前状态相反」
watch(() => form.buttonKey, () => {
  form.requestAction = isEnabled(form.buttonKey) ? 0 : 1;
});

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
    toast.success(`申请已提交: 「${LABELS[form.buttonKey]}」状态将由 ${actionText.value}, 等待角色菜单审核`);
    emit('submitted');
  } finally {
    submitting.value = false;
  }
}
</script>

<style scoped>
.footer { display: flex; justify-content: flex-end; gap: 8px; }
</style>
