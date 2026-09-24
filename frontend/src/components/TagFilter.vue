<template>
  <div class="tag-filter">
    <h4 class="filter-title">标签筛选{{ multiple ? '（可多选）' : '' }}</h4>
    <div class="tag-list">
      <el-tag
        :type="isAllActive ? '' : 'info'"
        class="tag-item"
        @click="selectAll"
        effect="dark"
      >
        全部
      </el-tag>
      <el-tag
        v-for="tag in tags"
        :key="tag"
        :type="isActive(tag) ? '' : 'info'"
        :effect="isActive(tag) ? 'dark' : 'plain'"
        class="tag-item"
        @click="selectTag(tag)"
      >
        {{ tag }}
      </el-tag>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  tags: {
    type: Array,
    default: () => []
  },
  // single-select mode (default, backwards compatible)
  selectedTag: {
    type: String,
    default: null
  },
  // multi-select mode
  selectedTags: {
    type: Array,
    default: () => []
  },
  multiple: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['select', 'update:selectedTags'])

const isAllActive = computed(() =>
  props.multiple ? props.selectedTags.length === 0 : props.selectedTag === null
)

function isActive(tag) {
  return props.multiple ? props.selectedTags.includes(tag) : props.selectedTag === tag
}

function selectAll() {
  if (props.multiple) {
    emit('update:selectedTags', [])
  } else {
    emit('select', null)
  }
}

function selectTag(tag) {
  if (props.multiple) {
    const next = props.selectedTags.includes(tag)
      ? props.selectedTags.filter((t) => t !== tag)
      : [...props.selectedTags, tag]
    emit('update:selectedTags', next)
  } else {
    emit('select', tag)
  }
}
</script>

<style scoped>
.tag-filter {
  margin-bottom: 20px;
}

.filter-title {
  font-size: 14px;
  color: #606266;
  margin-bottom: 10px;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-item {
  cursor: pointer;
}
</style>
