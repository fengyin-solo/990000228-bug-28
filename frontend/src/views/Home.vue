<template>
  <div class="home">
    <el-row :gutter="20">
      <el-col :span="18">
        <h2 class="page-title">
          {{ pageTitle }}
          <el-tag v-if="searchQuery" type="info" class="search-tag" closable @close="clearSearch">
            搜索: {{ searchQuery }}
          </el-tag>
        </h2>

        <div v-loading="loading">
          <section v-for="section in sections" :key="section.key" class="tag-section">
            <h3 v-if="section.tag && sections.length > 1" class="section-title">
              <el-tag effect="dark" size="small">{{ section.tag }}</el-tag>
              <span class="section-total">共 {{ section.pagination.total }} 篇</span>
            </h3>

            <el-alert
              v-if="section.error"
              type="error"
              :closable="false"
              class="section-error"
              :title="`「${section.tag || '全部'}」查询失败：${section.error}`"
            >
              <el-button size="small" @click="fetchAll">重试</el-button>
            </el-alert>

            <template v-else>
              <ArticleCard
                v-for="article in section.articles"
                :key="article.id"
                :article="article"
                :highlight-query="searchQuery"
                @tag-click="handleTagSelect"
              />
              <el-empty
                v-if="!loading && section.articles.length === 0"
                :description="emptyDescription"
              />
            </template>

            <Pagination
              v-if="!section.error"
              v-model="currentPage"
              :total="section.pagination.total"
              :page-size="section.pagination.limit"
              @change="handlePageChange"
            />
          </section>
        </div>
      </el-col>

      <el-col :span="6">
        <TagFilter
          :tags="tags"
          :selected-tags="selectedTags"
          multiple
          @update:selected-tags="handleTagsUpdate"
        />
      </el-col>
    </el-row>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { fetchBatch } from '../api'
import ArticleCard from '../components/ArticleCard.vue'
import TagFilter from '../components/TagFilter.vue'
import Pagination from '../components/Pagination.vue'

const route = useRoute()
const router = useRouter()

const PAGE_SIZE = 10

const tags = ref([])
const loading = ref(false)
const selectedTags = ref([])
const searchQuery = ref('')
const currentPage = ref(1)
// one section per selected tag combination, each with its own
// articles + pagination + error, so results never mix across combos
const sections = ref([])

// identity of the latest request; stale responses are dropped
let requestSeq = 0
let abortController = null

const pageTitle = computed(() => {
  if (searchQuery.value) {
    return '搜索结果'
  }
  if (selectedTags.value.length === 0) {
    return '最新文章'
  }
  return selectedTags.value.length === 1
    ? `标签: ${selectedTags.value[0]}`
    : `标签组合 (${selectedTags.value.length})`
})

const emptyDescription = computed(() => {
  if (searchQuery.value) {
    return '未找到匹配的文章'
  }
  return '暂无文章'
})

function parseTagsParam(value) {
  if (!value) return []
  const raw = Array.isArray(value) ? value.join(',') : String(value)
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function emptyPagination() {
  return { total: 0, page: currentPage.value, limit: PAGE_SIZE, totalPages: 0 }
}

onMounted(() => {
  selectedTags.value = parseTagsParam(route.query.tag)
  searchQuery.value = typeof route.query.search === 'string' ? route.query.search : ''
  fetchAll()
})

watch(
  () => route.query,
  (newQuery) => {
    const nextTags = parseTagsParam(newQuery.tag)
    const nextSearch = typeof newQuery.search === 'string' ? newQuery.search : ''
    const tagsChanged = nextTags.join('\n') !== selectedTags.value.join('\n')
    const searchChanged = nextSearch !== searchQuery.value
    if (!tagsChanged && !searchChanged) return
    selectedTags.value = nextTags
    searchQuery.value = nextSearch
    currentPage.value = 1
    fetchAll()
  }
)

async function fetchAll() {
  const seq = ++requestSeq
  if (abortController) {
    abortController.abort()
  }
  abortController = new AbortController()

  // every selected tag combination is one list query; all of them plus the
  // tag summary go out in a single batch request
  const combos = selectedTags.value.length > 0 ? [...selectedTags.value] : [null]
  const queries = combos.map((tag, index) => ({
    key: `list:${index}`,
    type: 'list',
    page: currentPage.value,
    limit: PAGE_SIZE,
    ...(tag ? { tag } : {}),
    ...(searchQuery.value ? { search: searchQuery.value } : {})
  }))
  queries.push({ key: 'tags', type: 'tags' })

  loading.value = true
  sections.value = combos.map((tag, index) => ({
    key: `list:${index}`,
    tag,
    articles: [],
    pagination: emptyPagination(),
    error: null
  }))

  try {
    const data = await fetchBatch(queries, { signal: abortController.signal })
    if (seq !== requestSeq) return // a newer request superseded this one

    // merge by the key each result echoes back, never by array position
    const byKey = new Map(data.results.map((result) => [result.key ?? result.index, result]))

    sections.value = combos.map((tag, index) => {
      const result = byKey.get(`list:${index}`)
      if (result && result.ok) {
        return {
          key: `list:${index}`,
          tag,
          articles: result.data.articles,
          pagination: result.data.pagination,
          error: null
        }
      }
      return {
        key: `list:${index}`,
        tag,
        articles: [],
        pagination: emptyPagination(),
        error: result?.error?.message || '查询失败'
      }
    })

    const tagsResult = byKey.get('tags')
    if (tagsResult && tagsResult.ok) {
      tags.value = tagsResult.data.tags
    }
  } catch (error) {
    if (error?.code === 'ERR_CANCELED' || error?.name === 'CanceledError') return
    if (seq !== requestSeq) return
    sections.value = sections.value.map((section) => ({
      ...section,
      error: '请求失败，请稍后重试'
    }))
    ElMessage.error('获取文章失败')
  } finally {
    if (seq === requestSeq) {
      loading.value = false
    }
  }
}

function applyTagSelection(nextTags) {
  selectedTags.value = nextTags
  currentPage.value = 1

  const query = {}
  if (nextTags.length) query.tag = nextTags.join(',')
  if (searchQuery.value) query.search = searchQuery.value

  router.replace({ query })
  fetchAll()
}

function handleTagsUpdate(nextTags) {
  applyTagSelection(nextTags)
}

function handleTagSelect(tag) {
  applyTagSelection(tag ? [tag] : [])
}

function handlePageChange(page) {
  currentPage.value = page
  fetchAll()
}

function clearSearch() {
  const query = {}
  if (selectedTags.value.length) query.tag = selectedTags.value.join(',')
  router.replace({ query })
}
</script>

<style scoped>
.home {
  padding-top: 20px;
}

.page-title {
  font-size: 24px;
  color: #303133;
  margin-bottom: 20px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-tag {
  font-size: 14px;
  font-weight: normal;
}

.tag-section {
  margin-bottom: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  color: #303133;
  margin: 8px 0 16px;
}

.section-total {
  font-size: 13px;
  color: #909399;
  font-weight: normal;
}

.section-error {
  margin-bottom: 16px;
}
</style>
