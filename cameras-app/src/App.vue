<template>
  <div class="cameras-app">
    <router-view />
  </div>
</template>

<script setup lang="ts">
// 应用根组件: 提供统一容器, 保证在 qiankun 容器内占满
</script>

<style scoped>
.cameras-app {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
  background: #f0f2f5;
}
</style>
