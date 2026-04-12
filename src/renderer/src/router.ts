import { createRouter, createWebHashHistory } from 'vue-router'
import Home from '@/views/Home.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: Home
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/Settings.vue')
    }
  ]
})

export default router
