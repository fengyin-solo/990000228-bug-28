<template>
  <div class="article-detail" v-loading="loading">
    <template v-if="article">
      <el-card>
        <template #header>
          <div class="article-header">
            <h1 class="article-title">{{ article.title }}</h1>
            <div class="article-meta">
              <span class="article-date">
                发布于 {{ formatDate(article.created_at) }}
              </span>
              <span v-if="article.updated_at !== article.created_at" class="article-date">
                更新于 {{ formatDate(article.updated_at) }}
              </span>
            </div>
            <div class="article-tags">
              <el-tag v-for="tag in article.tags" :key="tag" size="small">
                {{ tag }}
              </el-tag>
            </div>
          </div>
        </template>
        
        <div class="article-content" v-html="renderedContent"></div>
      </el-card>
      
      <div class="back-button">
        <el-button @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回列表
        </el-button>
      </div>
    </template>
    
    <el-empty v-if="!loading && !article" description="文章不存在" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { marked } from 'marked'
import api from '../api'

const route = useRoute()
const router = useRouter()

const article = ref(null)
const loading = ref(false)

// identity of the latest request; stale responses are dropped so the
// detail shown always matches the article in the current route
let requestSeq = 0

// Configure marked
marked.setOptions({
  breaks: true,
  gfm: true
})

const renderedContent = computed(() => {
  if (!article.value) return ''
  return marked(article.value.body)
})

onMounted(() => {
  fetchArticle(route.params.id)
})

watch(
  () => route.params.id,
  (id) => {
    if (id) fetchArticle(id)
  }
)

async function fetchArticle(id) {
  const seq = ++requestSeq
  loading.value = true
  try {
    const response = await api.get(`/articles/${id}`)
    if (seq !== requestSeq) return
    article.value = response.data
  } catch (error) {
    if (seq !== requestSeq) return
    article.value = null
    console.error('Failed to fetch article:', error)
  } finally {
    if (seq === requestSeq) {
      loading.value = false
    }
  }
}

function goBack() {
  router.push('/')
}

function formatDate(dateStr) {
  const date = new Date(dateStr)
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
}
</script>

<style scoped>
.article-detail {
  max-width: 800px;
  margin: 0 auto;
  padding-top: 20px;
}

.article-header {
  margin-bottom: 20px;
}

.article-title {
  font-size: 28px;
  color: #303133;
  margin-bottom: 12px;
}

.article-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 12px;
}

.article-date {
  color: #909399;
  font-size: 14px;
}

.article-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.article-content {
  line-height: 1.8;
  font-size: 16px;
}

.article-content :deep(h1) {
  font-size: 24px;
  margin: 24px 0 16px;
  color: #303133;
}

.article-content :deep(h2) {
  font-size: 20px;
  margin: 20px 0 12px;
  color: #303133;
}

.article-content :deep(h3) {
  font-size: 18px;
  margin: 16px 0 8px;
  color: #303133;
}

.article-content :deep(p) {
  margin-bottom: 16px;
}

.article-content :deep(pre) {
  background-color: #f5f7fa;
  padding: 16px;
  border-radius: 4px;
  overflow-x: auto;
  margin-bottom: 16px;
}

.article-content :deep(code) {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 14px;
}

.article-content :deep(ul),
.article-content :deep(ol) {
  margin-bottom: 16px;
  padding-left: 24px;
}

.article-content :deep(li) {
  margin-bottom: 8px;
}

.article-content :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.article-content :deep(th),
.article-content :deep(td) {
  border: 1px solid #dcdfe6;
  padding: 8px 12px;
  text-align: left;
}

.article-content :deep(th) {
  background-color: #f5f7fa;
}

.back-button {
  margin-top: 20px;
}
</style>
