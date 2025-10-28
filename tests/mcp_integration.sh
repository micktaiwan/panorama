#!/bin/bash
set -e

echo "🧪 MCP Integration Tests (TDD)"
echo "================================"
BASE_URL="http://localhost:3000/mcp"

# Test 1: List tools - should have tool_* prefix
echo ""
echo "Test 1: List tools and verify tool_* prefix..."
TOOLS=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')

# Check if first tool starts with tool_
FIRST_TOOL=$(echo $TOOLS | jq -r '.result.tools[0].name')
if [[ $FIRST_TOOL == tool_* ]]; then
  echo "✅ Tools have correct prefix: $FIRST_TOOL"
else
  echo "❌ FAIL: Expected tool_* but got $FIRST_TOOL"
  exit 1
fi

# Count total tools
TOTAL_TOOLS=$(echo $TOOLS | jq -r '.result.tools | length')
echo "   Found $TOTAL_TOOLS tools"

# Test 2: Call tool_tasksFilter
echo ""
echo "Test 2: Call tool_tasksFilter..."
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tool_tasksFilter","arguments":{}}}')

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_tasksFilter returned error: $ERROR"
  exit 1
fi

TOTAL=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.total')
if [ "$TOTAL" -gt 0 ]; then
  echo "✅ tool_tasksFilter returned $TOTAL tasks"
else
  echo "❌ FAIL: tool_tasksFilter returned no tasks"
  exit 1
fi

# Test 3: Call tool_projectsList
echo ""
echo "Test 3: Call tool_projectsList..."
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tool_projectsList","arguments":{}}}')

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_projectsList returned error: $ERROR"
  exit 1
fi

PROJECTS=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.total')
if [ "$PROJECTS" -gt 0 ]; then
  echo "✅ tool_projectsList returned $PROJECTS projects"
else
  echo "❌ FAIL: tool_projectsList returned no projects"
  exit 1
fi

# Test 4: Call tool_createTask
echo ""
echo "Test 4: Call tool_createTask..."
TIMESTAMP=$(date +%s)
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"tools/call\",\"params\":{\"name\":\"tool_createTask\",\"arguments\":{\"title\":\"TDD test task $TIMESTAMP\"}}}")

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_createTask returned error: $ERROR"
  exit 1
fi

TASK_ID=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.taskId')
if [ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ]; then
  echo "✅ tool_createTask created task $TASK_ID"
else
  echo "❌ FAIL: tool_createTask failed to create task"
  exit 1
fi

# Test 5: Call tool_updateTask
echo ""
echo "Test 5: Call tool_updateTask..."
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/call\",\"params\":{\"name\":\"tool_updateTask\",\"arguments\":{\"taskId\":\"$TASK_ID\",\"notes\":\"Updated from TDD integration test\"}}}")

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_updateTask returned error: $ERROR"
  exit 1
fi

UPDATED=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.updated')
if [ "$UPDATED" = "true" ]; then
  echo "✅ tool_updateTask updated task $TASK_ID"
else
  echo "❌ FAIL: tool_updateTask failed"
  exit 1
fi

# Test 6: Call tool_tasksFilter with filters
echo ""
echo "Test 6: Call tool_tasksFilter with important filter..."
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"tool_tasksFilter","arguments":{"important":true}}}')

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_tasksFilter with filter returned error: $ERROR"
  exit 1
fi

IMPORTANT_COUNT=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.total')
echo "✅ tool_tasksFilter with important=true returned $IMPORTANT_COUNT tasks"

# Test 7: Call tool_listTools
echo ""
echo "Test 7: Call tool_listTools..."
RESULT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tool_listTools","arguments":{}}}')

ERROR=$(echo $RESULT | jq -r '.error // empty')
if [ -n "$ERROR" ]; then
  echo "❌ FAIL: tool_listTools returned error: $ERROR"
  exit 1
fi

LISTED_TOOLS=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.total')
echo "✅ tool_listTools returned $LISTED_TOOLS tools"

# Test 8: Call tool_noteById
echo ""
echo "Test 8: Call tool_noteById..."
# First get a project with notes
PROJECT=$(curl -s -X POST $BASE_URL \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"tool_projectsList","arguments":{}}}' | \
  jq -r '.result.content[0].text' | jq -r '.projects[0].id')

if [ -n "$PROJECT" ] && [ "$PROJECT" != "null" ]; then
  # Get notes from this project
  NOTES=$(curl -s -X POST $BASE_URL \
    -H "Content-Type: application/json" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/call\",\"params\":{\"name\":\"tool_notesByProject\",\"arguments\":{\"projectId\":\"$PROJECT\"}}}")

  NOTE_ID=$(echo $NOTES | jq -r '.result.content[0].text' | jq -r '.notes[0].id')

  if [ -n "$NOTE_ID" ] && [ "$NOTE_ID" != "null" ]; then
    # Test tool_noteById with this note
    RESULT=$(curl -s -X POST $BASE_URL \
      -H "Content-Type: application/json" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{\"name\":\"tool_noteById\",\"arguments\":{\"noteId\":\"$NOTE_ID\"}}}")

    ERROR=$(echo $RESULT | jq -r '.error // empty')
    if [ -n "$ERROR" ]; then
      echo "❌ FAIL: tool_noteById returned error: $ERROR"
      exit 1
    fi

    # Check if content field is present
    CONTENT=$(echo $RESULT | jq -r '.result.content[0].text' | jq -r '.note.content // empty')
    if [ -n "$CONTENT" ]; then
      echo "✅ tool_noteById returned note with content (${#CONTENT} chars)"
    else
      echo "✅ tool_noteById returned note (no content)"
    fi
  else
    echo "⚠️  SKIP: No notes available for tool_noteById test"
  fi
else
  echo "⚠️  SKIP: No projects available for tool_noteById test"
fi

echo ""
echo "================================"
echo "🎉 All 8 MCP integration tests passed!"
