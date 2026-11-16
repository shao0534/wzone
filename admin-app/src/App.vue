<template>
  <div class="admin-app">
    <!-- admin-header 已去掉: 摄像头管理/申请权限入口由 CameraList 工具栏承载 -->
    <main class="admin-body">
      <router-view />
    </main>
  </div>
</template>

<script>
export default {
  name: 'AdminApp',
  created() {
    // 初始化按钮权限; 失败时至少在控制台留下线索(此前静默吞错导致问题难定位)
    this.$store.dispatch('initButtons').catch((e) => console.error('[admin] 初始化按钮权限失败:', e && e.message));
  },
};
</script>

<style scoped lang="less">
.admin-app {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f0f2f5;
}
.admin-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}
</style>
