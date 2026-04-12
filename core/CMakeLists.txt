cmake_minimum_required(VERSION 3.24)
project(ElasticDrumsCore VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ─── Sources ──────────────────────────────────────────────
set(CORE_SOURCES
    DrumCore.cpp
    voices/KickVoice.cpp
    voices/SnareVoice.cpp
    voices/ClapVoice.cpp
    voices/TomVoice.cpp
    voices/HiHatVoice.cpp
    voices/CymbalVoice.cpp
    voices/PercVoice.cpp
    voices/SampleVoice.cpp
    sequencer/Sequencer.cpp
    fx/Distortion.cpp
    fx/Filter.cpp
    fx/Compressor.cpp
    fx/Reverb.cpp
    fx/Delay.cpp
    mixer/Mixer.cpp
)

# ─── Library Target ───────────────────────────────────────
add_library(elastic-drums-core STATIC ${CORE_SOURCES})
target_include_directories(elastic-drums-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})

# ─── Compiler Flags ───────────────────────────────────────
if(NOT EMSCRIPTEN)
    target_compile_options(elastic-drums-core PRIVATE
        -Wall -Wextra -Wpedantic
        -ffast-math
        -fno-exceptions
    )
endif()

# ─── Emscripten / WASM Build ─────────────────────────────
if(EMSCRIPTEN)
    set(WASM_TARGET elastic-drums-wasm)

    add_executable(${WASM_TARGET} wasm/WasmBindings.cpp)
    target_link_libraries(${WASM_TARGET} PRIVATE elastic-drums-core)

    set_target_properties(${WASM_TARGET} PROPERTIES
        SUFFIX ".js"
        RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/wasm"
    )

    target_link_options(${WASM_TARGET} PRIVATE
        -O3
        -sWASM=1
        -sALLOW_MEMORY_GROWTH=1
        "-sEXPORTED_FUNCTIONS=['_malloc','_free']"
        "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        -sENVIRONMENT=worker
        -sSINGLE_FILE=0
        --no-entry
    )
endif()
