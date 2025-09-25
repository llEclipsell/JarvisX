
import sys
import chromadb
from sentence_transformers import SentenceTransformer

# Initialize ChromaDB client. 
# It will create a local database in a 'chroma_db' folder in the same directory.
client = chromadb.PersistentClient(path="./chroma_db")

# Get or create the collection to store notes
collection = client.get_or_create_collection("meeting_notes")

# Load a sentence transformer model for creating embeddings.
# This will be downloaded and cached on the first run.
try:
    model = SentenceTransformer('all-MiniLM-L6-v2')
except Exception as e:
    print(f"Error loading SentenceTransformer model: {e}", file=sys.stderr)
    sys.exit(1)

def store_text(text, doc_id):
    """Generates embeddings and stores a piece of text."""
    try:
        # The model expects a list of texts, even if it's just one
        embedding = model.encode([text])[0].tolist()
        collection.add(
            embeddings=[embedding],
            documents=[text],
            ids=[doc_id]
        )
        print(f"Stored document with ID: {doc_id}")
    except Exception as e:
        print(f"Error storing document: {e}", file=sys.stderr)

def retrieve_context(query, n_results=3):
    """Retrieves the most relevant context for a given query."""
    try:
        query_embedding = model.encode([query])[0].tolist()
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=n_results
        )
        # Print results to stdout so the Rust backend can capture them
        # Join with a unique separator to make parsing in Rust easier
        separator = "||--CONTEXT-SEPARATOR--||"
        print(separator.join(results['documents'][0]))

    except Exception as e:
        print(f"Error retrieving context: {e}", file=sys.stderr)

if __name__ == "__main__":
    # A simple command-line interface to be called from Rust
    if len(sys.argv) < 3:
        print("Usage: python personal_memory.py [store|retrieve] [args...]", file=sys.stderr)
        sys.exit(1)

    command = sys.argv[1]
    
    if command == "store":
        if len(sys.argv) == 4:
            # Arguments: "text to store", "unique_document_id"
            store_text(sys.argv[2], sys.argv[3])
        else:
            print("Usage: python personal_memory.py store \"text\" \"doc_id\"", file=sys.stderr)
    
    elif command == "retrieve":
        if len(sys.argv) == 3:
            # Argument: "query text"
            retrieve_context(sys.argv[2])
        else:
            print("Usage: python personal_memory.py retrieve \"query\"", file=sys.stderr)
    
    else:
        print(f"Unknown command: {command}", file=sys.stderr)

