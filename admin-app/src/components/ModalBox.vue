<template>
  <!--
    自建弹窗组件(替代 el-dialog / $confirm)。
    原因: qiankun 的 experimentalStyleIsolation 会给 element-ui 的选择器加上 [data-qiankun="admin"] 前缀,
    而 el-dialog 的遮罩(.v-modal)与 MessageBox($confirm) 都被 element-ui 挂到 document.body 上,
    这些节点既不带 qiankun 前缀、又位于子应用层叠上下文之外:
      - 遮罩 z-index(2000) 在 root 层 → 会把整个管理后台(含弹窗)压暗蒙住;
      - MessageBox 的 .el-message-box__wrapper 定位样式全部不命中 → 退化成普通流元素, 显示在页面左下角。
    本组件把遮罩与面板都渲染在子应用容器内(样式可命中), DOM 顺序保证面板在遮罩之上, 彻底绕开该问题。
  -->
  <div v-if="visible" class="mb-root">
    <div class="mb-mask" @click="maskClosable && $emit('close')"></div>
    <div class="mb-panel" :style="{ width: width }">
      <div class="mb-head">
        <span class="mb-title">{{ title }}</span>
        <span v-if="closable" class="mb-close" @click="$emit('close')">&times;</span>
      </div>
      <div class="mb-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="mb-foot">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'ModalBox',
  props: {
    visible: { type: Boolean, default: false },
    title: { type: String, default: '' },
    width: { type: String, default: '480px' },
    closable: { type: Boolean, default: true },
    // 点击遮罩是否关闭: 表单弹窗保持 false, 避免填一半误点丢失输入
    maskClosable: { type: Boolean, default: false },
  },
};
</script>

<style scoped lang="less">
// fixed 相对视口居中: 不受父级 overflow/层叠上下文影响, 与子应用容器同组, 面板在遮罩之后绘制即在上层
.mb-root {
  position: fixed;
  inset: 0;
  z-index: 3000;
}

.mb-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  animation: mb-fade 0.18s ease-out;
}

.mb-panel {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  max-width: calc(100% - 32px);
  max-height: calc(100% - 48px);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.22);
  overflow: hidden;
  animation: mb-pop 0.18s ease-out;
}

.mb-head {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid #ebeef5;
}

.mb-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
}

.mb-close {
  width: 26px;
  height: 26px;
  line-height: 24px;
  text-align: center;
  font-size: 20px;
  color: #909399;
  border-radius: 4px;
  cursor: pointer;
  user-select: none;

  &:hover {
    background: #f2f6fc;
    color: #409eff;
  }
}

.mb-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

.mb-foot {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid #ebeef5;
}

@keyframes mb-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes mb-pop {
  from { opacity: 0; transform: translate(-50%, -50%) scale(0.96); }
  to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
}
</style>
